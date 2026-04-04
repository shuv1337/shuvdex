# Tenant Lifecycle Operations

This runbook covers the full lifecycle of a shuvdex tenant: onboarding, day-to-day operations, and offboarding. All API calls use `SHUVDEX_API_URL` (default: `http://localhost:3847`) and a valid operator bearer token in `SHUVDEX_TOKEN`.

---

## Prerequisites

```bash
export SHUVDEX_API_URL="http://shuvdev:3847"
export SHUVDEX_TOKEN="<operator-bearer-token>"   # issue via scripts/ops/issue-operator-token.sh
```

---

## 1. Onboarding

### Step 1 — Create the tenant

> **Note:** The `POST /api/tenants` endpoint is implemented in the `packages/tenant-manager` package (Phase 3A). Ensure that package is deployed before running this step.

```bash
curl -s -X POST "${SHUVDEX_API_URL}/api/tenants" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -d '{
    "name": "Acme Corp",
    "tier": "standard",
    "ownerEmail": "admin@acme.example.com",
    "idpType": "entra",
    "idpTenantId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  }' | jq .
```

Expected response — note the `tenantId`:
```json
{
  "tenantId": "tenant_<hex>",
  "name": "Acme Corp",
  "tier": "standard",
  "status": "active",
  "idpType": "entra",
  "idpTenantId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "createdAt": "2026-04-04T00:00:00.000Z"
}
```

Save the tenant ID:
```bash
TENANT_ID="tenant_<hex>"
```

### Step 2 — Apply the matching policy template

Templates live in `docs/templates/`. Available: `core`, `standard`, `custom`.

```bash
curl -s -X POST "${SHUVDEX_API_URL}/api/tenants/${TENANT_ID}/apply-template" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -d '{"templateId": "standard"}' | jq .
```

This configures:
- `maxConnectors`: 5
- `maxUsers`: 50
- Role mappings: `standard-users` → read, `power-users` → write
- Audit retention: 180 days, quarterly review cadence

To inspect a template before applying:
```bash
cat docs/templates/standard.json | jq .
```

### Step 3 — Create the production environment

```bash
curl -s -X POST "${SHUVDEX_API_URL}/api/tenants/${TENANT_ID}/environments" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -d '{
    "name": "production",
    "type": "production"
  }' | jq .
```

Expected response — note the `environmentId`:
```json
{
  "environmentId": "env_<hex>",
  "tenantId": "tenant_<hex>",
  "name": "production",
  "type": "production",
  "createdAt": "2026-04-04T00:00:00.000Z"
}
```

```bash
ENV_ID="env_<hex>"
```

### Step 4 — Configure IdP mapping

For **Microsoft Entra ID** tenants, set the Entra tenant ID (already provided in Step 1). Confirm the IdP config is live:

```bash
# Verify the tenant has the correct IdP mapping
curl -s "${SHUVDEX_API_URL}/api/tenants/${TENANT_ID}" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" | jq '.idpType, .idpTenantId'
```

For **Google Workspace** tenants, supply the primary domain instead:

```bash
curl -s -X POST "${SHUVDEX_API_URL}/api/tenants" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -d '{
    "name": "Acme Corp",
    "tier": "standard",
    "ownerEmail": "admin@acme.example",
    "idpType": "google",
    "idpDomain": "acme.example"
  }' | jq .
```

### Step 5 — Bind credentials for each integration

For each integration the tenant uses, bind a credential:

```bash
# Example: bind a HubSpot API key for this tenant
curl -s -X POST "${SHUVDEX_API_URL}/api/credentials" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -d '{
    "name": "acme-hubspot",
    "type": "api_key",
    "value": "<hubspot-api-key>"
  }' | jq .

CRED_ID="<returned credentialId>"

curl -s -X POST "${SHUVDEX_API_URL}/api/credentials/bindings" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -d '{
    "bindingId": "acme-hubspot-prod",
    "tenantId": "'"${TENANT_ID}"'",
    "environmentId": "'"${ENV_ID}"'",
    "credentialId": "'"${CRED_ID}"'",
    "allowedPackages": ["hubspot"]
  }' | jq .
```

Repeat for each integration (M365, Google Workspace, QuickBooks, etc.).

### Step 6 — Register upstream connectors

Register each MCP upstream the tenant will use:

```bash
# Example: register the HubSpot MCP server for this tenant
curl -s -X POST "${SHUVDEX_API_URL}/api/upstreams" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -d '{
    "name": "HubSpot CRM",
    "transport": "streamable-http",
    "endpoint": "https://mcp.hubspot.com/v1",
    "namespace": "hubspot",
    "credentialId": "'"${CRED_ID}"'",
    "trustState": "pending_review",
    "defaultActionClass": "read",
    "defaultRiskLevel": "medium",
    "owner": "'"${TENANT_ID}"'",
    "purpose": "CRM data access for Acme Corp"
  }' | jq .
```

Submit an approval request for each connector:

```bash
curl -s -X POST "${SHUVDEX_API_URL}/api/approvals" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -d '{
    "tenantId": "'"${TENANT_ID}"'",
    "requestType": "package_approval",
    "targetId": "hubspot",
    "targetName": "HubSpot CRM",
    "requestedBy": "admin@acme.example.com",
    "requestedState": "approved",
    "justification": "Standard CRM integration for Standard tier tenant"
  }' | jq .
```

Approve the request:

```bash
APPROVAL_ID="<returned requestId>"

curl -s -X POST "${SHUVDEX_API_URL}/api/approvals/${APPROVAL_ID}/decide" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -d '{
    "decision": "approved",
    "decidedBy": "operator@latitudes.io",
    "notes": "Standard tier — HubSpot approved"
  }' | jq .
```

### Step 7 — Create the gateway

```bash
curl -s -X POST "${SHUVDEX_API_URL}/api/tenants/${TENANT_ID}/gateways" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -d '{
    "environmentId": "'"${ENV_ID}"'",
    "name": "Acme Production Gateway",
    "transport": "streamable-http",
    "authMode": "entra"
  }' | jq .
```

Expected response — note the `connectionUrl`:
```json
{
  "gatewayId": "gw_<hex>",
  "tenantId": "tenant_<hex>",
  "environmentId": "env_<hex>",
  "connectionUrl": "https://shuvdev:3848/tenant/tenant_<hex>/mcp",
  "status": "active"
}
```

### Step 8 — Generate and share the connection URL

The `connectionUrl` from Step 7 is what users add to their AI assistant (Claude Desktop, Cursor, ChatGPT, etc.).

```bash
CONNECTION_URL="https://shuvdev:3848/tenant/${TENANT_ID}/mcp"
echo "Connection URL for Acme Corp: ${CONNECTION_URL}"
```

Users add this URL in their AI client, sign in with their work account (Entra ID or Google Workspace), and are immediately scoped to their role and approved tools.

### Step 9 — Test with an MCP client

```bash
# Minimal MCP initialize probe
curl -s -X POST "${CONNECTION_URL}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-03-26",
      "capabilities": {},
      "clientInfo": {"name": "onboard-test", "version": "0.0.0"}
    }
  }' | jq .result.serverInfo
```

---

## 2. Day-to-day operations

### Add an integration

1. Register the upstream (Step 6 above).
2. Bind credentials for the tenant (Step 5 above).
3. Create and approve an approval request (Step 6 above).
4. Verify it appears in the gateway's tool list:

```bash
curl -s "${SHUVDEX_API_URL}/api/upstreams" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" | jq '.[].name'
```

### Remove an integration

1. Revoke the credential binding:

```bash
curl -s -X DELETE "${SHUVDEX_API_URL}/api/credentials/bindings/${BINDING_ID}" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}"
```

2. Suspend the upstream:

```bash
curl -s -X PATCH "${SHUVDEX_API_URL}/api/upstreams/${UPSTREAM_ID}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -d '{"trustState": "suspended"}' | jq .
```

### Update role mappings

Role mappings are part of the policy bundle. Submit a policy update:

```bash
curl -s -X PUT "${SHUVDEX_API_URL}/api/policies/acme-power-users" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -d '{
    "id": "acme-power-users",
    "description": "Power users - write access to approved connectors",
    "scopes": ["capabilities:write"],
    "allowPackages": ["hubspot", "m365"],
    "maxRiskLevel": "high"
  }' | jq .
```

### Review the approval queue

List all pending approval requests:

```bash
curl -s "${SHUVDEX_API_URL}/api/approvals?status=pending" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" | jq .
```

List requests for a specific tenant:

```bash
curl -s "${SHUVDEX_API_URL}/api/approvals?tenantId=${TENANT_ID}" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" | jq .
```

### Audit trail queries

Query recent tool invocations for a tenant:

```bash
curl -s "${SHUVDEX_API_URL}/api/audit?tenantId=${TENANT_ID}&limit=50" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" | jq .events
```

Query by actor (user email/ID):

```bash
curl -s "${SHUVDEX_API_URL}/api/audit?actorId=alice@acme.example.com&limit=100" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" | jq .events
```

Query only denied events (security review):

```bash
curl -s "${SHUVDEX_API_URL}/api/audit?decision=deny&from=2026-04-01T00:00:00Z" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" | jq .events
```

Export all events for a tenant to JSONL:

```bash
curl -s "${SHUVDEX_API_URL}/api/audit/export?tenantId=${TENANT_ID}" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -o "acme-audit-$(date +%Y%m%d).jsonl"
```

### Break-glass procedure

When a time-sensitive situation requires access outside the normal approval flow, use break-glass. Every break-glass action is permanently recorded and requires post-incident review.

Record a break-glass event:

```bash
curl -s -X POST "${SHUVDEX_API_URL}/api/break-glass" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -d '{
    "tenantId": "'"${TENANT_ID}"'",
    "actor": "operator@latitudes.io",
    "action": "temporary_write_grant",
    "targetId": "quickbooks.create_invoice",
    "justification": "Client unable to process payroll — board approval obtained — incident #2026-001"
  }' | jq .

BREAK_GLASS_ID="<returned eventId>"
```

Review the event after the incident:

```bash
curl -s -X POST "${SHUVDEX_API_URL}/api/break-glass/${BREAK_GLASS_ID}/review" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -d '{"reviewedBy": "security@latitudes.io"}' | jq .
```

List unreviewed break-glass events:

```bash
curl -s "${SHUVDEX_API_URL}/api/break-glass" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" | jq '[.[] | select(.reviewed == false)]'
```

---

## 3. Offboarding

### Step 1 — Suspend the tenant

Suspending stops new connections without immediately destroying data.

```bash
curl -s -X POST "${SHUVDEX_API_URL}/api/tenants/${TENANT_ID}/suspend" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -d '{"reason": "Contract ended 2026-04-04"}' | jq .
```

### Step 2 — Revoke all credentials

List and delete every binding for the tenant:

```bash
# List all bindings for this tenant
curl -s "${SHUVDEX_API_URL}/api/credentials/bindings" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" | \
  jq -r --arg tid "${TENANT_ID}" '.[] | select(.tenantId == $tid) | .bindingId'
```

Then for each `BINDING_ID`:

```bash
curl -s -X DELETE "${SHUVDEX_API_URL}/api/credentials/bindings/${BINDING_ID}" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}"
```

### Step 3 — Export audit logs

Download the complete audit trail before archiving:

```bash
curl -s "${SHUVDEX_API_URL}/api/audit/export?tenantId=${TENANT_ID}" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -o "audit-${TENANT_ID}-final-$(date +%Y%m%d).jsonl"

echo "Exported $(wc -l < "audit-${TENANT_ID}-final-$(date +%Y%m%d).jsonl") audit events"
```

### Step 4 — Archive the tenant

```bash
curl -s -X POST "${SHUVDEX_API_URL}/api/tenants/${TENANT_ID}/archive" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -d '{"reason": "Offboarded 2026-04-04"}' | jq .
```

Archived tenants remain readable for compliance purposes but cannot issue new connections.

### Step 5 — Clean up the gateway

```bash
GATEWAY_ID="gw_<hex>"

curl -s -X DELETE "${SHUVDEX_API_URL}/api/tenants/${TENANT_ID}/gateways/${GATEWAY_ID}" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}"
```

Remove upstream registrations associated with this tenant:

```bash
# List upstreams owned by this tenant
curl -s "${SHUVDEX_API_URL}/api/upstreams" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" | \
  jq -r --arg tid "${TENANT_ID}" '.[] | select(.owner == $tid) | .upstreamId'
```

Then for each `UPSTREAM_ID`:

```bash
curl -s -X DELETE "${SHUVDEX_API_URL}/api/upstreams/${UPSTREAM_ID}" \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}"
```

---

## Quick reference

| Action                        | Command                                                    |
|-------------------------------|-----------------------------------------------------------|
| List all tenants              | `GET /api/tenants`                                        |
| Get tenant                    | `GET /api/tenants/:id`                                    |
| Create tenant                 | `POST /api/tenants`                                       |
| Apply policy template         | `POST /api/tenants/:id/apply-template`                    |
| Create environment            | `POST /api/tenants/:id/environments`                      |
| Create gateway                | `POST /api/tenants/:id/gateways`                          |
| Suspend tenant                | `POST /api/tenants/:id/suspend`                           |
| Archive tenant                | `POST /api/tenants/:id/archive`                           |
| List approval queue           | `GET /api/approvals?status=pending`                       |
| Decide approval               | `POST /api/approvals/:id/decide`                          |
| Record break-glass            | `POST /api/break-glass`                                   |
| Review break-glass            | `POST /api/break-glass/:id/review`                        |
| Export audit log              | `GET /api/audit/export?tenantId=:id`                      |
| Check service health          | `./scripts/ops/health-check.sh --host shuvdev`            |

---

## See also

- [Credential management runbook](./credential-management.md)
- [Access management runbook](./access-management.md)
- [Incident response runbook](./incident-response.md)
- [Package lifecycle runbook](./package-lifecycle.md)
- [Policy templates](../templates/) — `core.json`, `standard.json`, `custom.json`
- [MSP-MCP plan](../PLAN-MSP-MCP.md) — Phase 3 section for full architecture context
