# shuvdex Operator Guide

This guide covers the day-to-day operation of a shuvdex deployment. It is written for the internal Latitudes team acting as the first MSP operator on the platform.

---

## Table of contents

1. [Overview](#1-overview)
2. [Service endpoints and ports](#2-service-endpoints-and-ports)
3. [Operator scripts quick reference](#3-operator-scripts-quick-reference)
4. [Day-to-day operations](#4-day-to-day-operations)
   - [Check system health](#check-system-health)
   - [View active packages](#view-active-packages)
   - [Add a new skill](#add-a-new-skill)
   - [Add an API integration (OpenAPI source)](#add-an-api-integration-openapi-source)
   - [Issue a token to a user or AI host](#issue-a-token-to-a-user-or-ai-host)
   - [Review access activity](#review-access-activity)
5. [Common workflows](#5-common-workflows)
6. [Troubleshooting](#6-troubleshooting)
7. [Runbook index](#7-runbook-index)
8. [Environment variables](#8-environment-variables)
9. [Escalation](#9-escalation)

---

## 1. Overview

shuvdex is the capability gateway behind Latitudes Managed AI Connectivity. It exposes a single MCP endpoint to AI clients (Claude, Cursor, ChatGPT Desktop, etc.) and controls which tools are visible and callable based on the caller's identity and policy.

From an operator's perspective, the three main activities are:

1. **Capability management** — registering, enabling, and disabling packages of tools
2. **Access management** — issuing tokens, defining policies, reviewing the audit trail
3. **Credential management** — storing and rotating the API keys used to call upstream services

Everything is controlled through the **admin API** (`http://localhost:3847`). The MCP server (`http://localhost:3848`) is the consumer-facing endpoint that AI clients connect to.

---

## 2. Service endpoints and ports

| Service | Default URL | Purpose |
|---------|-------------|---------|
| Admin API | `http://localhost:3847` | Package, credential, policy, audit management |
| MCP server | `http://localhost:3848` | AI client endpoint (tools/call, tools/list) |
| MCP health | `http://localhost:3848/health` | Health probe for the MCP server |
| API health | `http://localhost:3847/health` | Health probe for the admin API |

On shuvdev (the deployed host):

| Service | URL |
|---------|-----|
| MCP server | `http://shuvdev:3848/mcp` |
| MCP health | `http://shuvdev:3848/health` |

Override the admin API URL for all scripts and `curl` examples:

```bash
export SHUVDEX_API_URL=http://shuvdev:3847
export SHUVDEX_TOKEN=eyJhbGciOi...
```

---

## 3. Operator scripts quick reference

All scripts live in `scripts/ops/`. They use `SHUVDEX_API_URL` and `SHUVDEX_TOKEN` from the environment. Run any script with `--help` for usage.

| Script | Purpose |
|--------|---------|
| `health-check.sh` | Check API and MCP server are up |
| `package-status.sh` | List all packages with capability counts |
| `issue-operator-token.sh` | Issue a JWT token for an operator or AI host |
| `register-openapi-source.sh` | Register an OpenAPI source and sync it |
| `rotate-credential.sh` | Safely rotate a credential (create new, update refs, delete old) |
| `audit-search.sh` | Search audit events with filters |
| `kill-switch.sh` | Emergency: disable a tool or package immediately |

```bash
# Quick health check
./scripts/ops/health-check.sh --host shuvdev

# Show all packages
./scripts/ops/package-status.sh

# Issue an admin token (24 hours)
./scripts/ops/issue-operator-token.sh "operator@latitudes.io" admin 86400

# Search audit for denied events
./scripts/ops/audit-search.sh --denied-only --limit 20

# Emergency: disable a tool
./scripts/ops/kill-switch.sh skill.crawl.start
```

---

## 4. Day-to-day operations

### Check system health

Run this first whenever something seems wrong:

```bash
./scripts/ops/health-check.sh
```

For the remote deployment:
```bash
./scripts/ops/health-check.sh --host shuvdev --mcp-init
```

Expected output: both `api-health` and `mcp-health` show green/ok with latency under 100ms.

Alternatively with `curl`:
```bash
curl -s http://localhost:3847/health | jq .
curl -s http://localhost:3848/health | jq .
```

---

### View active packages

```bash
./scripts/ops/package-status.sh
```

Or with the API directly:
```bash
curl -s http://localhost:3847/api/packages | \
  jq '.[] | {id, version, enabled, caps: (.capabilities | length)}'
```

To force a reindex from the local repo before listing:
```bash
./scripts/ops/package-status.sh --refresh
```

---

### Add a new skill

1. Copy the template:
   ```bash
   cp -r examples/module-runtime-skill-template skills/my-skill
   ```

2. Edit `capability.yaml` and implement the entrypoint module.

3. Test locally:
   ```bash
   echo '{"args": {"message": "hello"}}' | node skills/my-skill/my-tool.mcp.mjs
   ```

4. Reindex:
   ```bash
   curl -s -X POST http://localhost:3847/api/packages/reindex | jq .
   ```

5. Verify in MCP:
   ```bash
   curl -s http://localhost:3848/mcp \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | \
     jq '.result.tools[] | select(.name | startswith("skill.my_skill"))'
   ```

See [runbooks/module-runtime-skill.md](runbooks/module-runtime-skill.md) for the complete guide.

---

### Add an API integration (OpenAPI source)

**Step 1:** Create the credential:
```bash
curl -s -X POST http://localhost:3847/api/credentials \
  -H "Content-Type: application/json" \
  -d '{
    "credentialId": "my-api-key",
    "description": "My API production key",
    "scheme": {"type": "bearer", "token": "YOUR_TOKEN_HERE"}
  }' | jq .
```

**Step 2:** Register the source:
```bash
./scripts/ops/register-openapi-source.sh my-api \
  https://api.example.com/openapi.json \
  https://api.example.com \
  my-api-key
```

See [runbooks/openapi-source.md](runbooks/openapi-source.md) for the full guide including inspection, troubleshooting, and rotation.

---

### Issue a token to a user or AI host

```bash
./scripts/ops/issue-operator-token.sh "claude-desktop-workstation" "skill:read,skill:apply" 2592000
```

Copy the `token` field from the output and share it with the user or configure it in their AI client.

For the MCP client configuration URL (when auth is enabled):
```
http://shuvdev:3848/mcp
# Add: Authorization: Bearer <token>
```

See [runbooks/access-management.md](runbooks/access-management.md) for the full guide.

---

### Review access activity

```bash
# Recent tool calls
./scripts/ops/audit-search.sh --action call_tool --limit 30

# Denied access (authorization failures)
./scripts/ops/audit-search.sh --denied-only

# Activity for a specific user
./scripts/ops/audit-search.sh --subject "user@example.com"

# Activity on a specific package
./scripts/ops/audit-search.sh --package "openapi.gitea.api"
```

---

## 5. Common workflows

### Rotate an API key credential

```bash
./scripts/ops/rotate-credential.sh my-api-key
```

The script will prompt for the new secret, create the replacement, update all sources, test auth, and delete the old credential. See [runbooks/credential-management.md](runbooks/credential-management.md#7-rotate-a-credential) for the manual procedure.

### Disable a tool in an emergency

```bash
./scripts/ops/kill-switch.sh <capability-id-or-package-id>

# Preview first
./scripts/ops/kill-switch.sh openapi.quickbooks.api --dry-run
```

See [runbooks/incident-response.md](runbooks/incident-response.md) for the full incident response procedure.

### Roll back a skill to a previous version

Re-import the previous archive with `force=true`:
```bash
curl -s -X POST http://localhost:3847/api/packages/import \
  -F "file=@/path/to/skill-archive-v1.0.0.tar.gz" \
  -F "force=true" | jq .
```

### Revoke a token

```bash
curl -s -X POST http://localhost:3847/api/tokens/revoke \
  -H "Content-Type: application/json" \
  -d '{"jti": "01J..."}' | jq .
```

The `jti` is shown in the output of `issue-operator-token.sh` and in the `claims.jti` field of the issuance response.

### Restrict a user to specific packages

```bash
# Create a policy that limits the scope to specific packages
curl -s -X PUT http://localhost:3847/api/policies/my-restricted-policy \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Restricted to low-risk tools only",
    "scopes": ["skill:read"],
    "allowPackages": ["skill.module_runtime_template"],
    "maxRiskLevel": "low"
  }' | jq .
```

Then issue a token with the matching scope:
```bash
./scripts/ops/issue-operator-token.sh "restricted-user@example.com" "skill:read"
```

---

## 6. Troubleshooting

### API returns 404 for all routes

The admin API is not running. Check the process:
```bash
systemctl --user status shuvdex-mcp.service
# or
ps aux | grep "node.*api"
```

### MCP tools/list returns empty

1. Check packages are indexed:
   ```bash
   curl -s -X POST http://localhost:3847/api/packages/reindex | jq .
   ```

2. Check capabilities are enabled:
   ```bash
   ./scripts/ops/package-status.sh
   ```

3. Check the MCP server health:
   ```bash
   curl -s http://localhost:3848/health | jq .
   ```

### Tool calls return `isError: true`

1. Check the capability is enabled:
   ```bash
   curl -s http://localhost:3847/api/tools/<tool-id> | jq .enabled
   ```

2. Check the audit log for the denial reason:
   ```bash
   ./scripts/ops/audit-search.sh --capability <tool-id> --denied-only
   ```

3. For module_runtime skills: test the entrypoint directly:
   ```bash
   echo '{"args": {...}}' | node skills/my-skill/my-tool.mcp.mjs
   ```

4. For OpenAPI sources: test auth:
   ```bash
   curl -s -X POST http://localhost:3847/api/sources/openapi/<source-id>/test-auth | jq .
   ```

### Authorization always denies

Check the token is valid and not expired:
```bash
curl -s -X POST http://localhost:3847/api/tokens/verify \
  -H "Content-Type: application/json" \
  -d '{"token": "<token>"}' | jq .
```

Check there are no `denyPackages` policies blocking access:
```bash
curl -s http://localhost:3847/api/policies | jq '.[] | {id, denyPackages, denyCapabilities}'
```

### Credential not working after rotation

Check the source is pointing to the new credential ID:
```bash
curl -s http://localhost:3847/api/sources/openapi | \
  jq '.[] | {sourceId, credentialId}'
```

Re-run the auth test:
```bash
curl -s -X POST http://localhost:3847/api/sources/openapi/<source-id>/test-auth | jq .
```

### Orphaned import directories

```bash
# List orphans
curl -s -X POST http://localhost:3847/api/packages/cleanup -d '{}' | jq .orphans

# Remove orphans
curl -s -X POST http://localhost:3847/api/packages/cleanup \
  -H "Content-Type: application/json" \
  -d '{"force": true}' | jq .
```

---

## 7. Runbook index

| Topic | Runbook |
|-------|---------|
| Register, enable, disable, delete packages | [runbooks/package-lifecycle.md](runbooks/package-lifecycle.md) |
| Add an OpenAPI API integration | [runbooks/openapi-source.md](runbooks/openapi-source.md) |
| Manage API keys and credentials | [runbooks/credential-management.md](runbooks/credential-management.md) |
| Issue tokens, define policies, audit access | [runbooks/access-management.md](runbooks/access-management.md) |
| Build a new module runtime skill | [runbooks/module-runtime-skill.md](runbooks/module-runtime-skill.md) |
| Kill switches, incident investigation | [runbooks/incident-response.md](runbooks/incident-response.md) |

---

## 8. Environment variables

All operator scripts and examples respect these environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `SHUVDEX_API_URL` | `http://localhost:3847` | Admin API base URL |
| `SHUVDEX_MCP_URL` | `http://localhost:3848` | MCP server base URL |
| `SHUVDEX_TOKEN` | _(empty)_ | Bearer token sent in `Authorization` header |

Server-side environment variables (set in `.env` or systemd unit):

| Variable | Default | Purpose |
|----------|---------|---------|
| `HOST` | `0.0.0.0` | API listen address |
| `PORT` | `3847` | API listen port |
| `MCP_HOST` | `0.0.0.0` | MCP listen address |
| `MCP_PORT` | `3848` | MCP listen port |
| `CAPABILITIES_DIR` | `.capabilities/packages` | Package YAML directory |
| `POLICY_DIR` | `.capabilities/policy` | Policy YAML directory |
| `IMPORTS_DIR` | `.capabilities/imports` | Imported archive directory |
| `LOCAL_REPO_PATH` | `$PWD` | Repository root for skill indexer |
| `CORS_ALLOWED_ORIGINS` | `localhost:5173,...` | Comma-separated allowed CORS origins |

---

## 9. Escalation

For incidents affecting production capabilities or user access:

1. **Immediate containment:** Use `kill-switch.sh` to disable affected tools
2. **Investigate:** Use `audit-search.sh` to trace the incident
3. **Internal channel:** Post in the ops channel with the output of:
   ```bash
   ./scripts/ops/health-check.sh --host shuvdev --mcp-init
   ./scripts/ops/package-status.sh
   ./scripts/ops/audit-search.sh --denied-only --limit 50
   ```
4. **Recovery:** Follow [runbooks/incident-response.md](runbooks/incident-response.md)

After any incident, update [AGENTS.md](../AGENTS.md) with anything operationally useful so the next operator — human or AI — isn't starting from scratch.

---

*Latitudes operator guide — shuvdex Phase 1E*
