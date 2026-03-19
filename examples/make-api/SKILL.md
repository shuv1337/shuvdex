---
name: make-api
description: Manage Make.com (Integromat) scenarios, connections, data stores, and webhooks via the full REST API.
---

# Make API Skill

Manage Make.com (formerly Integromat) scenarios, connections, data stores, and webhooks via the full REST API.

## Setup

**API Token:** Get your token from Make → Profile → API Tokens  
**Zone:** Default is `eu1` (other options: eu2, us1, us2)

## Configuration

Credentials are loaded from multiple sources (first match wins):

1. **`~/.env`** ← preferred
2. `~/.openclaw/.env`
3. `~/.openclaw/credentials/make-api.json` (JSON: `{"token": "...", "zone": "..."}`)
4. Environment variables (`MAKE_API_TOKEN`, `MAKE_ZONE`)
5. `~/.clawdbot/.env` (legacy)

Example `.env` format:
```bash
MAKE_API_TOKEN=your-token-here
MAKE_ZONE=us1
```

Example JSON format (`~/.openclaw/credentials/make-api.json`):
```json
{
  "token": "your-token-here",
  "zone": "us1"
}
```

## Usage via mcporter

```bash
# List all tools
mcporter list make-api --schema

# === SCENARIOS (15 tools) ===
mcporter call make-api.scenarios_list --args '{"teamId": 123}'
mcporter call make-api.scenarios_get --args '{"scenarioId": 925}'
mcporter call make-api.scenarios_start --args '{"scenarioId": 925}'
mcporter call make-api.scenarios_stop --args '{"scenarioId": 925}'
mcporter call make-api.scenarios_run --args '{"scenarioId": 925}'
mcporter call make-api.scenarios_run --args '{"scenarioId": 925, "responsive": true}'
mcporter call make-api.scenarios_run --args '{"scenarioId": 925, "replayOfExecutionId": "abc123"}'
mcporter call make-api.scenarios_delete --args '{"scenarioId": 925}'
mcporter call make-api.scenarios_logs_list --args '{"scenarioId": 925}'
mcporter call make-api.scenarios_blueprint_get --args '{"scenarioId": 925}'
mcporter call make-api.scenarios_clone --args '{"scenarioId": 925, "teamId": 123, "name": "Copy"}'
mcporter call make-api.scenarios_executions_list --args '{"scenarioId": 925}'
mcporter call make-api.scenarios_executions_get --args '{"scenarioId": 925, "executionId": "abc123"}'
mcporter call make-api.scenarios_usage_get --args '{"scenarioId": 925}'
mcporter call make-api.scenarios_interface_get --args '{"scenarioId": 925}'

# === CONNECTIONS (9 tools) ===
mcporter call make-api.connections_list --args '{"teamId": 123}'
mcporter call make-api.connections_get --args '{"connectionId": 456}'
mcporter call make-api.connections_create --args '{"teamId": 123, "accountName": "My AWS", "accountType": "aws"}'
mcporter call make-api.connections_delete --args '{"connectionId": 456, "confirmed": true}'
mcporter call make-api.connections_rename --args '{"connectionId": 456, "name": "New Name"}'
mcporter call make-api.connections_test --args '{"connectionId": 456}'
mcporter call make-api.connections_editable_schema --args '{"connectionId": 456}'

# === DATA STORES (6 tools) ===
mcporter call make-api.data_stores_list --args '{"teamId": 123}'
mcporter call make-api.data_stores_get --args '{"dataStoreId": 789}'
mcporter call make-api.data_stores_records_list --args '{"dataStoreId": 789}'
mcporter call make-api.data_stores_records_create --args '{"dataStoreId": 789, "key": "user-1", "data": {"name": "John"}}'
mcporter call make-api.data_stores_records_delete --args '{"dataStoreId": 789, "keys": ["user-1"]}'
mcporter call make-api.data_stores_record_update --args '{"dataStoreId": 789, "dataStoreKeyRecord": "user-1", "data": {"name": "Jane"}}'

# === HOOKS/WEBHOOKS (11 tools) ===
mcporter call make-api.hooks_list --args '{"teamId": 123}'
mcporter call make-api.hooks_get --args '{"hookId": 111}'
mcporter call make-api.hooks_create --args '{"teamId": 123, "name": "My Webhook", "typeName": "gateway-webhook"}'
mcporter call make-api.hooks_delete --args '{"hookId": 111, "confirmed": true}'
mcporter call make-api.hooks_ping --args '{"hookId": 111}'
mcporter call make-api.hooks_enable --args '{"hookId": 111}'
mcporter call make-api.hooks_disable --args '{"hookId": 111}'
mcporter call make-api.hooks_learn_start --args '{"hookId": 111}'
mcporter call make-api.hooks_learn_stop --args '{"hookId": 111}'

# === OTHER (4 tools) ===
mcporter call make-api.scenario_folders_list --args '{"teamId": 123}'
mcporter call make-api.teams_list --args '{}'
mcporter call make-api.organizations_list --args '{}'
mcporter call make-api.users_me --args '{}'
```

## Available Tools (45 total)

### Scenarios (15)
| Tool | Description |
|------|-------------|
| `scenarios_list` | List all scenarios for a team |
| `scenarios_get` | Get scenario details |
| `scenarios_create` | Create a new scenario |
| `scenarios_update` | Update a scenario |
| `scenarios_delete` | Delete a scenario |
| `scenarios_start` | Activate a scenario |
| `scenarios_stop` | Deactivate a scenario |
| `scenarios_run` | Run a scenario (supports replay via `replayOfExecutionId`) |
| `scenarios_clone` | Clone a scenario |
| `scenarios_logs_list` | Get execution logs |
| `scenarios_blueprint_get` | Get scenario blueprint |
| `scenarios_interface_get` | Get scenario interface |
| `scenarios_usage_get` | Get usage stats |
| `scenarios_executions_list` | List executions |
| `scenarios_executions_get` | Get execution details |

### Connections (9)
| Tool | Description |
|------|-------------|
| `connections_list` | List connections |
| `connections_get` | Get connection details |
| `connections_create` | Create a connection |
| `connections_delete` | Delete a connection |
| `connections_rename` | Rename a connection |
| `connections_test` | Test connection |
| `connections_editable_schema` | Get updatable params |
| `connections_set_data` | Update connection data |
| `connections_scoped` | Verify scopes |

### Data Stores (6)
| Tool | Description |
|------|-------------|
| `data_stores_list` | List data stores |
| `data_stores_get` | Get data store details |
| `data_stores_records_list` | List records |
| `data_stores_records_create` | Create record |
| `data_stores_records_delete` | Delete records |
| `data_stores_record_update` | Update record |

### Hooks/Webhooks (11)
| Tool | Description |
|------|-------------|
| `hooks_list` | List hooks |
| `hooks_get` | Get hook details |
| `hooks_create` | Create a hook |
| `hooks_delete` | Delete a hook |
| `hooks_update` | Update a hook |
| `hooks_ping` | Check hook status |
| `hooks_enable` | Enable hook |
| `hooks_disable` | Disable hook |
| `hooks_learn_start` | Start learning structure |
| `hooks_learn_stop` | Stop learning structure |
| `hooks_set_data` | Set hook data |

### Other (4)
| Tool | Description |
|------|-------------|
| `scenario_folders_list` | List folders |
| `teams_list` | List teams |
| `organizations_list` | List organizations |
| `users_me` | Get current user |

## Zone Reference
- `eu1` → https://eu1.make.com
- `eu2` → https://eu2.make.com  
- `us1` → https://us1.make.com
- `us2` → https://us2.make.com

## Example: Complete Workflow

```bash
# 1. Verify auth
mcporter call make-api.users_me --args '{}'

# 2. List teams
mcporter call make-api.teams_list --args '{}'

# 3. List scenarios
mcporter call make-api.scenarios_list --args '{"teamId": 123}'

# 4. Get specific scenario
mcporter call make-api.scenarios_get --args '{"scenarioId": 925}'

# 5. Replay a failed execution
mcporter call make-api.scenarios_run --args '{"scenarioId": 925, "replayOfExecutionId": "abc123"}'

# 6. Check execution status
mcporter call make-api.scenarios_executions_get --args '{"scenarioId": 925, "executionId": "xyz789"}'

# 7. List all executions for a scenario
mcporter call make-api.scenarios_executions_list --args '{"scenarioId": 925}'

# 8. Create a webhook for external triggers
mcporter call make-api.hooks_create --args '{
  "teamId": 123,
  "name": "Moltbot Trigger",
  "typeName": "gateway-webhook"
}'

# 9. Use the webhook URL in Make scenarios
# The response includes the webhook URL to use
```

## 🧪 Code Mode (experimental, phase-2)

Code Mode provides a sandboxed JavaScript environment for ad-hoc tool exploration and multi-step Make.com workflows.

> **Note:** This is a sidecar-only integration — the existing MCP server (`make_api_server.py`) is not modified.

### Search — explore available tools

```bash
# List all tools
python make-api/scripts/codemode.py search --code 'async () => tools' --json

# Filter by name
python make-api/scripts/codemode.py search --code 'async () => tools.filter(t => t.name.includes("scenario"))' --json
```

### Execute — run tool calls with safety gates

```bash
# Read-only: list scenarios
python make-api/scripts/codemode.py execute --code 'async () => await codemode.callTool({ tool: "scenarios_list", args: { teamId: 123 } })' --json

# Write (requires --allow-write)
python make-api/scripts/codemode.py execute --code 'async () => await codemode.callTool({ tool: "scenarios_run", args: { scenarioId: 925 } })' --allow-write --yes --json
```

### Safety model

| Policy | Default |
|---|---|
| Tool classification | Read/write tools explicitly classified |
| Unknown tool default | Deny (conservative) |
| Write requires | `--allow-write` flag |
| Timeout | 30s (`--timeout N`) |
| Max calls | 20 (`--max-calls N`) |
| Audit trail | Every tool call logged |
