#!/usr/bin/env python3
"""
Make API MCP Server

Wraps Make.com REST API for use with mcporter.
Full API coverage for scenarios, connections, data stores, hooks, and more.
"""

import asyncio
import os
from typing import Any

import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

# Configuration — load from multiple sources (first match wins)
def _load_config() -> tuple[str, str]:
    """Load MAKE_API_TOKEN and MAKE_ZONE from config sources.
    
    Search order:
      1. ~/.env
      2. ~/.openclaw/.env
      3. ~/.openclaw/credentials/make-api.json
      4. Environment variables (already set)
      5. ~/.clawdbot/.env (legacy)
    """
    import json
    from pathlib import Path

    token = ""
    zone = ""

    # Helper to parse KEY=VALUE .env files (no shell expansion)
    def _parse_env(path: Path) -> dict[str, str]:
        vals: dict[str, str] = {}
        if not path.is_file():
            return vals
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            vals[k] = v
        return vals

    env_files = [
        Path.home() / ".env",
        Path.home() / ".openclaw" / ".env",
        Path.home() / ".clawdbot" / ".env",  # legacy
    ]

    for env_path in env_files:
        vals = _parse_env(env_path)
        if not token and vals.get("MAKE_API_TOKEN"):
            token = vals["MAKE_API_TOKEN"]
        if not zone and vals.get("MAKE_ZONE"):
            zone = vals["MAKE_ZONE"]
        if token and zone:
            break

    # Try JSON credentials file
    json_path = Path.home() / ".openclaw" / "credentials" / "make-api.json"
    if (not token or not zone) and json_path.is_file():
        try:
            creds = json.loads(json_path.read_text())
            if not token:
                token = creds.get("token", creds.get("api_token", ""))
            if not zone:
                zone = creds.get("zone", "")
        except (json.JSONDecodeError, OSError):
            pass

    # Fall back to environment variables
    if not token:
        token = os.environ.get("MAKE_API_TOKEN", "")
    if not zone:
        zone = os.environ.get("MAKE_ZONE", "eu1")

    return token, zone


API_TOKEN, ZONE = _load_config()
BASE_URL = f"https://{ZONE}.make.com/api/v2"


def get_headers() -> dict:
    return {
        "Authorization": f"Token {API_TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


async def make_request(
    method: str, endpoint: str, params: dict = None, json_data: dict = None
) -> dict:
    """Make API request with error handling."""
    url = f"{BASE_URL}{endpoint}"
    
    client_kwargs = {
        "headers": get_headers(),
        "timeout": 30.0,
    }
    
    if params:
        client_kwargs["params"] = params
    if json_data:
        client_kwargs["json"] = json_data
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.request(method, url, **client_kwargs)
            response.raise_for_status()
            return response.json()
    except httpx.HTTPStatusError as e:
        return {"error": f"HTTP {e.response.status_code}: {e.response.text}"}
    except Exception as e:
        return {"error": str(e)}


# ==================== SCENARIOS ====================

async def scenarios_list(teamId: int, **kwargs) -> dict:
    """List all scenarios for a team."""
    params = {"teamId": teamId}
    params.update({k: v for k, v in kwargs.items() if v is not None})
    return await make_request("GET", "/scenarios", params=params)


async def scenarios_get(scenarioId: int, **kwargs) -> dict:
    """Get details of a specific scenario."""
    params = {k: v for k, v in kwargs.items() if v is not None}
    return await make_request("GET", f"/scenarios/{scenarioId}", params=params)


async def scenarios_create(teamId: int, blueprint: str, scheduling: str, folderId: int = None, **kwargs) -> dict:
    """Create a new scenario."""
    data = {"teamId": teamId, "blueprint": blueprint, "scheduling": scheduling}
    if folderId:
        data["folderId"] = folderId
    data.update({k: v for k, v in kwargs.items() if v is not None})
    return await make_request("POST", "/scenarios", json_data=data)


async def scenarios_update(scenarioId: int, **kwargs) -> dict:
    """Update a scenario."""
    data = {k: v for k, v in kwargs.items() if v is not None}
    # Make API expects blueprint as a JSON string, not an object
    if "blueprint" in data and not isinstance(data["blueprint"], str):
        import json as _json
        data["blueprint"] = _json.dumps(data["blueprint"])
    return await make_request("PATCH", f"/scenarios/{scenarioId}", json_data=data)


async def scenarios_delete(scenarioId: int) -> dict:
    """Delete a scenario."""
    return await make_request("DELETE", f"/scenarios/{scenarioId}")


async def scenarios_start(scenarioId: int) -> dict:
    """Activate a scenario."""
    return await make_request("POST", f"/scenarios/{scenarioId}/start")


async def scenarios_stop(scenarioId: int) -> dict:
    """Deactivate a scenario."""
    return await make_request("POST", f"/scenarios/{scenarioId}/stop")


async def scenarios_run(scenarioId: int, data: dict = None, responsive: bool = False, replayOfExecutionId: str = None, **kwargs) -> dict:
    """Run a scenario immediately. Optionally replay a specific execution."""
    json_data = {}
    if data:
        json_data["data"] = data
    if responsive:
        json_data["responsive"] = responsive
    json_data.update({k: v for k, v in kwargs.items() if v is not None})
    
    # Build URL with query param for replay
    endpoint = f"/scenarios/{scenarioId}/run"
    if replayOfExecutionId:
        endpoint += f"?replayOfExecutionId={replayOfExecutionId}"
    
    return await make_request("POST", endpoint, json_data=json_data if json_data else None)


async def scenarios_clone(scenarioId: int, teamId: int, name: str, organizationId: int = None, **kwargs) -> dict:
    """Clone a scenario."""
    data = {"teamId": teamId, "name": name, "states": True}
    if organizationId:
        data["organizationId"] = organizationId
    data.update({k: v for k, v in kwargs.items() if v is not None})
    return await make_request("POST", f"/scenarios/{scenarioId}/clone", json_data=data)


async def scenarios_logs_list(scenarioId: int, **kwargs) -> dict:
    """Get execution logs for a scenario."""
    params = {k: v for k, v in kwargs.items() if v is not None}
    return await make_request("GET", f"/scenarios/{scenarioId}/logs", params=params)


async def scenarios_blueprint_get(scenarioId: int) -> dict:
    """Get the blueprint of a scenario."""
    return await make_request("GET", f"/scenarios/{scenarioId}/blueprint")


async def scenarios_interface_get(scenarioId: int) -> dict:
    """Get scenario interface (inputs/outputs)."""
    return await make_request("GET", f"/scenarios/{scenarioId}/interface")


async def scenarios_usage_get(scenarioId: int, **kwargs) -> dict:
    """Get scenario usage stats."""
    params = {k: v for k, v in kwargs.items() if v is not None}
    return await make_request("GET", f"/scenarios/{scenarioId}/usage", params=params)


async def scenarios_executions_get(scenarioId: int, executionId: str, **kwargs) -> dict:
    """Get details of a specific execution."""
    params = {k: v for k, v in kwargs.items() if v is not None}
    return await make_request("GET", f"/scenarios/{scenarioId}/executions/{executionId}", params=params)


async def scenarios_executions_list(scenarioId: int, **kwargs) -> dict:
    """List executions for a scenario."""
    params = {k: v for k, v in kwargs.items() if v is not None}
    return await make_request("GET", f"/scenarios/{scenarioId}/executions", params=params)


# ==================== CONNECTIONS ====================

async def connections_list(teamId: int, **kwargs) -> dict:
    """List all connections for a team."""
    params = {"teamId": teamId}
    params.update({k: v for k, v in kwargs.items() if v is not None})
    return await make_request("GET", "/connections", params=params)


async def connections_get(connectionId: int, **kwargs) -> dict:
    """Get details of a specific connection."""
    params = {k: v for k, v in kwargs.items() if v is not None}
    return await make_request("GET", f"/connections/{connectionId}", params=params)


async def connections_create(teamId: int, accountName: str, accountType: str, scopes: list = None, **kwargs) -> dict:
    """Create a new connection."""
    data = {"teamId": teamId, "accountName": accountName, "accountType": accountType}
    if scopes:
        data["scopes"] = scopes
    data.update({k: v for k, v in kwargs.items() if v is not None})
    return await make_request("POST", f"/connections", json_data=data)


async def connections_delete(connectionId: int, confirmed: bool = False) -> dict:
    """Delete a connection."""
    params = {"confirmed": confirmed} if confirmed else {}
    return await make_request("DELETE", f"/connections/{connectionId}", params=params)


async def connections_rename(connectionId: int, name: str, **kwargs) -> dict:
    """Rename a connection."""
    params = {k: v for k, v in kwargs.items() if v is not None}
    return await make_request("PATCH", f"/connections/{connectionId}", params=params, json_data={"name": name})


async def connections_test(connectionId: int) -> dict:
    """Verify if a connection is valid."""
    return await make_request("POST", f"/connections/{connectionId}/test")


async def connections_editable_schema(connectionId: int) -> dict:
    """Get updatable connection parameters."""
    return await make_request("GET", f"/connections/{connectionId}/editable-data-schema")


async def connections_set_data(connectionId: int, **kwargs) -> dict:
    """Update connection data."""
    data = {k: v for k, v in kwargs.items() if v is not None}
    return await make_request("POST", f"/connections/{connectionId}/set-data", json_data=data)


async def connections_scoped(connectionId: int, scope: list) -> dict:
    """Verify if connection has required scopes."""
    return await make_request("POST", f"/connections/{connectionId}/scoped", json_data={"scope": scope})


# ==================== DATA STORES ====================

async def data_stores_list(teamId: int, **kwargs) -> dict:
    """List all data stores for a team."""
    params = {"teamId": teamId}
    params.update({k: v for k, v in kwargs.items() if v is not None})
    return await make_request("GET", "/data-stores", params=params)


async def data_stores_get(dataStoreId: int, **kwargs) -> dict:
    """Get details of a data store."""
    params = {k: v for k, v in kwargs.items() if v is not None}
    return await make_request("GET", f"/data-stores/{dataStoreId}", params=params)


async def data_stores_records_list(dataStoreId: int, **kwargs) -> dict:
    """List records in a data store."""
    params = {k: v for k, v in kwargs.items() if v is not None}
    return await make_request("GET", f"/data-stores/{dataStoreId}/data", params=params)


async def data_stores_records_create(dataStoreId: int, key: str = None, data: dict = None, **kwargs) -> dict:
    """Create a record in a data store."""
    record_data = {}
    if key:
        record_data["key"] = key
    if data:
        record_data["data"] = data
    record_data.update({k: v for k, v in kwargs.items() if v is not None})
    return await make_request("POST", f"/data-stores/{dataStoreId}/data", json_data=record_data)


async def data_stores_records_delete(dataStoreId: int, keys: list = None, all: bool = False, confirmed: bool = False, exceptKeys: list = None) -> dict:
    """Delete records from a data store."""
    params = {"confirmed": confirmed} if confirmed else {}
    json_data = {}
    if keys:
        json_data["keys"] = keys
    if all:
        json_data["all"] = True
    if exceptKeys:
        json_data["exceptKeys"] = exceptKeys
    return await make_request("DELETE", f"/data-stores/{dataStoreId}/data", params=params, json_data=json_data if json_data else None)


async def data_stores_record_update(dataStoreId: int, dataStoreKeyRecord: str, data: dict, **kwargs) -> dict:
    """Update entire data store record (PUT)."""
    json_data = {"data": data}
    json_data.update({k: v for k, v in kwargs.items() if v is not None})
    return await make_request("PUT", f"/data-stores/{dataStoreId}/data/{dataStoreKeyRecord}", json_data=json_data)


async def data_stores_record_patch(dataStoreId: int, dataStoreKeyRecord: str, data: dict, **kwargs) -> dict:
    """Update data store record partially (PATCH)."""
    json_data = {"data": data}
    json_data.update({k: v for k, v in kwargs.items() if v is not None})
    return await make_request("PATCH", f"/data-stores/{dataStoreId}/data/{dataStoreKeyRecord}", json_data=json_data)


# ==================== HOOKS ====================

async def hooks_list(teamId: int, typeName: str = None, assigned: bool = None, **kwargs) -> dict:
    """List all hooks for a team."""
    params = {"teamId": teamId}
    if typeName:
        params["typeName"] = typeName
    if assigned is not None:
        params["assigned"] = assigned
    params.update({k: v for k, v in kwargs.items() if v is not None})
    return await make_request("GET", "/hooks", params=params)


async def hooks_get(hookId: int) -> dict:
    """Get details of a hook."""
    return await make_request("GET", f"/hooks/{hookId}")


async def hooks_create(teamId: int, name: str, typeName: str, method: bool = True, header: bool = True, stringify: bool = False, **kwargs) -> dict:
    """Create a new hook."""
    data = {
        "teamId": teamId,
        "name": name,
        "typeName": typeName,
        "method": method,
        "header": header,
        "stringify": stringify,
    }
    data.update({k: v for k, v in kwargs.items() if v is not None})
    return await make_request("POST", "/hooks", json_data=data)


async def hooks_delete(hookId: int, confirmed: bool = False) -> dict:
    """Delete a hook."""
    params = {"confirmed": confirmed} if confirmed else {}
    return await make_request("DELETE", f"/hooks/{hookId}", params=params)


async def hooks_update(hookId: int, name: str = None, **kwargs) -> dict:
    """Update a hook."""
    data = {}
    if name:
        data["name"] = name
    data.update({k: v for k, v in kwargs.items() if v is not None})
    return await make_request("PATCH", f"/hooks/{hookId}", json_data=data)


async def hooks_ping(hookId: int) -> dict:
    """Check if hook is active and get its status."""
    return await make_request("GET", f"/hooks/{hookId}/ping")


async def hooks_learn_start(hookId: int) -> dict:
    """Start learning request body structure."""
    return await make_request("POST", f"/hooks/{hookId}/learn-start")


async def hooks_learn_stop(hookId: int) -> dict:
    """Stop learning request body structure."""
    return await make_request("POST", f"/hooks/{hookId}/learn-stop")


async def hooks_enable(hookId: int) -> dict:
    """Enable a disabled hook."""
    return await make_request("POST", f"/hooks/{hookId}/enable")


async def hooks_disable(hookId: int) -> dict:
    """Disable a hook."""
    return await make_request("POST", f"/hooks/{hookId}/disable")


async def hooks_set_data(hookId: int, **kwargs) -> dict:
    """Set hook data."""
    data = {k: v for k, v in kwargs.items() if v is not None}
    return await make_request("POST", f"/hooks/{hookId}/set-data", json_data=data)


# ==================== OTHER ====================

async def scenario_folders_list(teamId: int, **kwargs) -> dict:
    """List scenario folders for a team."""
    params = {"teamId": teamId}
    params.update({k: v for k, v in kwargs.items() if v is not None})
    return await make_request("GET", "/scenario-folders", params=params)


async def teams_list(**kwargs) -> dict:
    """List all teams."""
    params = {k: v for k, v in kwargs.items() if v is not None}
    return await make_request("GET", "/teams", params=params)


async def organizations_list(**kwargs) -> dict:
    """List all organizations."""
    params = {k: v for k, v in kwargs.items() if v is not None}
    return await make_request("GET", "/organizations", params=params)


async def users_me() -> dict:
    """Get current user info."""
    return await make_request("GET", "/users/me")


# ==================== MCP SERVER ====================

app = Server("make-api")


@app.list_tools()
async def list_tools() -> list[Tool]:
    """List available tools."""
    return [
        # Scenarios (12 tools)
        Tool(name="scenarios_list", description="List all scenarios for a team", inputSchema={"type": "object", "properties": {"teamId": {"type": "integer", "description": "Team ID (required)"}, "isActive": {"type": "boolean"}, "folderId": {"type": "integer"}, "pg[limit]": {"type": "integer"}, "pg[offset]": {"type": "integer"}}, "required": ["teamId"]}),
        Tool(name="scenarios_get", description="Get details of a specific scenario", inputSchema={"type": "object", "properties": {"scenarioId": {"type": "integer", "description": "Scenario ID (required)"}}, "required": ["scenarioId"]}),
        Tool(name="scenarios_create", description="Create a new scenario", inputSchema={"type": "object", "properties": {"teamId": {"type": "integer"}, "blueprint": {"type": "string"}, "scheduling": {"type": "string"}, "folderId": {"type": "integer"}}, "required": ["teamId", "blueprint", "scheduling"]}),
        Tool(name="scenarios_update", description="Update a scenario (supports name, blueprint as JSON string, scheduling)", inputSchema={"type": "object", "properties": {"scenarioId": {"type": "integer"}, "name": {"type": "string"}, "blueprint": {"type": ["string", "object"], "description": "Scenario blueprint (JSON string or object)"}, "scheduling": {"type": "string"}}, "required": ["scenarioId"]}),
        Tool(name="scenarios_delete", description="Delete a scenario", inputSchema={"type": "object", "properties": {"scenarioId": {"type": "integer"}}, "required": ["scenarioId"]}),
        Tool(name="scenarios_start", description="Activate/start a scenario", inputSchema={"type": "object", "properties": {"scenarioId": {"type": "integer"}}, "required": ["scenarioId"]}),
        Tool(name="scenarios_stop", description="Deactivate/stop a scenario", inputSchema={"type": "object", "properties": {"scenarioId": {"type": "integer"}}, "required": ["scenarioId"]}),
        Tool(name="scenarios_run", description="Run a scenario immediately. Optionally replay a specific execution by passing replayOfExecutionId.", inputSchema={"type": "object", "properties": {"scenarioId": {"type": "integer"}, "data": {"type": "object"}, "responsive": {"type": "boolean"}, "replayOfExecutionId": {"type": "string", "description": "Execution ID to replay (optional)"}}, "required": ["scenarioId"]}),
        Tool(name="scenarios_clone", description="Clone a scenario", inputSchema={"type": "object", "properties": {"scenarioId": {"type": "integer"}, "teamId": {"type": "integer"}, "name": {"type": "string"}, "organizationId": {"type": "integer"}}, "required": ["scenarioId", "teamId", "name"]}),
        Tool(name="scenarios_logs_list", description="Get execution logs for a scenario", inputSchema={"type": "object", "properties": {"scenarioId": {"type": "integer"}}, "required": ["scenarioId"]}),
        Tool(name="scenarios_blueprint_get", description="Get the blueprint of a scenario", inputSchema={"type": "object", "properties": {"scenarioId": {"type": "integer"}}, "required": ["scenarioId"]}),
        Tool(name="scenarios_interface_get", description="Get scenario interface (inputs/outputs)", inputSchema={"type": "object", "properties": {"scenarioId": {"type": "integer"}}, "required": ["scenarioId"]}),
        Tool(name="scenarios_usage_get", description="Get scenario usage stats", inputSchema={"type": "object", "properties": {"scenarioId": {"type": "integer"}}, "required": ["scenarioId"]}),
        Tool(name="scenarios_executions_get", description="Get details of a specific execution", inputSchema={"type": "object", "properties": {"scenarioId": {"type": "integer"}, "executionId": {"type": "string"}}, "required": ["scenarioId", "executionId"]}),
        Tool(name="scenarios_executions_list", description="List executions for a scenario", inputSchema={"type": "object", "properties": {"scenarioId": {"type": "integer"}}, "required": ["scenarioId"]}),
        
        # Connections (9 tools)
        Tool(name="connections_list", description="List all connections for a team", inputSchema={"type": "object", "properties": {"teamId": {"type": "integer"}}, "required": ["teamId"]}),
        Tool(name="connections_get", description="Get details of a specific connection", inputSchema={"type": "object", "properties": {"connectionId": {"type": "integer"}}, "required": ["connectionId"]}),
        Tool(name="connections_create", description="Create a new connection", inputSchema={"type": "object", "properties": {"teamId": {"type": "integer"}, "accountName": {"type": "string"}, "accountType": {"type": "string"}, "scopes": {"type": "array", "items": {"type": "string"}}}, "required": ["teamId", "accountName", "accountType"]}),
        Tool(name="connections_delete", description="Delete a connection", inputSchema={"type": "object", "properties": {"connectionId": {"type": "integer"}, "confirmed": {"type": "boolean"}}, "required": ["connectionId"]}),
        Tool(name="connections_rename", description="Rename a connection", inputSchema={"type": "object", "properties": {"connectionId": {"type": "integer"}, "name": {"type": "string"}}, "required": ["connectionId", "name"]}),
        Tool(name="connections_test", description="Verify if a connection is valid", inputSchema={"type": "object", "properties": {"connectionId": {"type": "integer"}}, "required": ["connectionId"]}),
        Tool(name="connections_editable_schema", description="Get updatable connection parameters", inputSchema={"type": "object", "properties": {"connectionId": {"type": "integer"}}, "required": ["connectionId"]}),
        Tool(name="connections_set_data", description="Update connection data", inputSchema={"type": "object", "properties": {"connectionId": {"type": "integer"}}, "required": ["connectionId"]}),
        Tool(name="connections_scoped", description="Verify if connection has required scopes", inputSchema={"type": "object", "properties": {"connectionId": {"type": "integer"}, "scope": {"type": "array", "items": {"type": "string"}}}, "required": ["connectionId", "scope"]}),
        
        # Data Stores (6 tools)
        Tool(name="data_stores_list", description="List all data stores for a team", inputSchema={"type": "object", "properties": {"teamId": {"type": "integer"}}, "required": ["teamId"]}),
        Tool(name="data_stores_get", description="Get details of a data store", inputSchema={"type": "object", "properties": {"dataStoreId": {"type": "integer"}}, "required": ["dataStoreId"]}),
        Tool(name="data_stores_records_list", description="List records in a data store", inputSchema={"type": "object", "properties": {"dataStoreId": {"type": "integer"}, "pg[limit]": {"type": "integer"}, "pg[offset]": {"type": "integer"}}, "required": ["dataStoreId"]}),
        Tool(name="data_stores_records_create", description="Create a record in a data store", inputSchema={"type": "object", "properties": {"dataStoreId": {"type": "integer"}, "key": {"type": "string"}, "data": {"type": "object"}}, "required": ["dataStoreId"]}),
        Tool(name="data_stores_records_delete", description="Delete records from a data store", inputSchema={"type": "object", "properties": {"dataStoreId": {"type": "integer"}, "keys": {"type": "array", "items": {"type": "string"}}, "all": {"type": "boolean"}, "confirmed": {"type": "boolean"}, "exceptKeys": {"type": "array", "items": {"type": "string"}}}, "required": ["dataStoreId"]}),
        Tool(name="data_stores_record_update", description="Update entire data store record (PUT)", inputSchema={"type": "object", "properties": {"dataStoreId": {"type": "integer"}, "dataStoreKeyRecord": {"type": "string"}, "data": {"type": "object"}}, "required": ["dataStoreId", "dataStoreKeyRecord", "data"]}),
        
        # Hooks/Webhooks (11 tools)
        Tool(name="hooks_list", description="List all hooks for a team", inputSchema={"type": "object", "properties": {"teamId": {"type": "integer"}, "typeName": {"type": "string"}, "assigned": {"type": "boolean"}}, "required": ["teamId"]}),
        Tool(name="hooks_get", description="Get details of a hook", inputSchema={"type": "object", "properties": {"hookId": {"type": "integer"}}, "required": ["hookId"]}),
        Tool(name="hooks_create", description="Create a new hook", inputSchema={"type": "object", "properties": {"teamId": {"type": "integer"}, "name": {"type": "string"}, "typeName": {"type": "string"}, "method": {"type": "boolean"}, "header": {"type": "boolean"}, "stringify": {"type": "boolean"}}, "required": ["teamId", "name", "typeName"]}),
        Tool(name="hooks_delete", description="Delete a hook", inputSchema={"type": "object", "properties": {"hookId": {"type": "integer"}, "confirmed": {"type": "boolean"}}, "required": ["hookId"]}),
        Tool(name="hooks_update", description="Update a hook", inputSchema={"type": "object", "properties": {"hookId": {"type": "integer"}, "name": {"type": "string"}}, "required": ["hookId"]}),
        Tool(name="hooks_ping", description="Check if hook is active and get its status", inputSchema={"type": "object", "properties": {"hookId": {"type": "integer"}}, "required": ["hookId"]}),
        Tool(name="hooks_learn_start", description="Start learning request body structure", inputSchema={"type": "object", "properties": {"hookId": {"type": "integer"}}, "required": ["hookId"]}),
        Tool(name="hooks_learn_stop", description="Stop learning request body structure", inputSchema={"type": "object", "properties": {"hookId": {"type": "integer"}}, "required": ["hookId"]}),
        Tool(name="hooks_enable", description="Enable a disabled hook", inputSchema={"type": "object", "properties": {"hookId": {"type": "integer"}}, "required": ["hookId"]}),
        Tool(name="hooks_disable", description="Disable a hook", inputSchema={"type": "object", "properties": {"hookId": {"type": "integer"}}, "required": ["hookId"]}),
        Tool(name="hooks_set_data", description="Set hook data", inputSchema={"type": "object", "properties": {"hookId": {"type": "integer"}}, "required": ["hookId"]}),
        
        # Other (4 tools)
        Tool(name="scenario_folders_list", description="List scenario folders for a team", inputSchema={"type": "object", "properties": {"teamId": {"type": "integer"}}, "required": ["teamId"]}),
        Tool(name="teams_list", description="List all teams", inputSchema={"type": "object", "properties": {}}),
        Tool(name="organizations_list", description="List all organizations", inputSchema={"type": "object", "properties": {}}),
        Tool(name="users_me", description="Get current user info", inputSchema={"type": "object", "properties": {}}),
    ]


@app.call_tool()
async def call_tool(name: str, arguments: Any) -> list[TextContent]:
    """Handle tool calls."""
    try:
        result = None
        
        # Scenarios
        if name == "scenarios_list":
            result = await scenarios_list(**arguments)
        elif name == "scenarios_get":
            result = await scenarios_get(**arguments)
        elif name == "scenarios_create":
            result = await scenarios_create(**arguments)
        elif name == "scenarios_update":
            result = await scenarios_update(**arguments)
        elif name == "scenarios_delete":
            result = await scenarios_delete(**arguments)
        elif name == "scenarios_start":
            result = await scenarios_start(**arguments)
        elif name == "scenarios_stop":
            result = await scenarios_stop(**arguments)
        elif name == "scenarios_run":
            result = await scenarios_run(**arguments)
        elif name == "scenarios_clone":
            result = await scenarios_clone(**arguments)
        elif name == "scenarios_logs_list":
            result = await scenarios_logs_list(**arguments)
        elif name == "scenarios_blueprint_get":
            result = await scenarios_blueprint_get(**arguments)
        elif name == "scenarios_interface_get":
            result = await scenarios_interface_get(**arguments)
        elif name == "scenarios_usage_get":
            result = await scenarios_usage_get(**arguments)
        elif name == "scenarios_executions_get":
            result = await scenarios_executions_get(**arguments)
        elif name == "scenarios_executions_list":
            result = await scenarios_executions_list(**arguments)
        
        # Connections
        elif name == "connections_list":
            result = await connections_list(**arguments)
        elif name == "connections_get":
            result = await connections_get(**arguments)
        elif name == "connections_create":
            result = await connections_create(**arguments)
        elif name == "connections_delete":
            result = await connections_delete(**arguments)
        elif name == "connections_rename":
            result = await connections_rename(**arguments)
        elif name == "connections_test":
            result = await connections_test(**arguments)
        elif name == "connections_editable_schema":
            result = await connections_editable_schema(**arguments)
        elif name == "connections_set_data":
            result = await connections_set_data(**arguments)
        elif name == "connections_scoped":
            result = await connections_scoped(**arguments)
        
        # Data Stores
        elif name == "data_stores_list":
            result = await data_stores_list(**arguments)
        elif name == "data_stores_get":
            result = await data_stores_get(**arguments)
        elif name == "data_stores_records_list":
            result = await data_stores_records_list(**arguments)
        elif name == "data_stores_records_create":
            result = await data_stores_records_create(**arguments)
        elif name == "data_stores_records_delete":
            result = await data_stores_records_delete(**arguments)
        elif name == "data_stores_record_update":
            result = await data_stores_record_update(**arguments)
        
        # Hooks
        elif name == "hooks_list":
            result = await hooks_list(**arguments)
        elif name == "hooks_get":
            result = await hooks_get(**arguments)
        elif name == "hooks_create":
            result = await hooks_create(**arguments)
        elif name == "hooks_delete":
            result = await hooks_delete(**arguments)
        elif name == "hooks_update":
            result = await hooks_update(**arguments)
        elif name == "hooks_ping":
            result = await hooks_ping(**arguments)
        elif name == "hooks_learn_start":
            result = await hooks_learn_start(**arguments)
        elif name == "hooks_learn_stop":
            result = await hooks_learn_stop(**arguments)
        elif name == "hooks_enable":
            result = await hooks_enable(**arguments)
        elif name == "hooks_disable":
            result = await hooks_disable(**arguments)
        elif name == "hooks_set_data":
            result = await hooks_set_data(**arguments)
        
        # Other
        elif name == "scenario_folders_list":
            result = await scenario_folders_list(**arguments)
        elif name == "teams_list":
            result = await teams_list(**arguments)
        elif name == "organizations_list":
            result = await organizations_list(**arguments)
        elif name == "users_me":
            result = await users_me()
        
        else:
            return [TextContent(type="text", text=f"Unknown tool: {name}")]
        
        return [TextContent(type="text", text=str(result))]
    
    except Exception as e:
        return [TextContent(type="text", text=f"Error: {str(e)}")]


async def main():
    """Run the MCP server."""
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
