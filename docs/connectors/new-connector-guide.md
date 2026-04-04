# New Connector Guide

A step-by-step playbook for adding a new upstream connector to the shuvdex platform. Follow each
step in sequence. Do not skip ahead — earlier steps produce identifiers and pin states that later
steps depend on.

**Audience:** Latitudes operators

---

## Prerequisites

- Operator token with `platform_admin` role (or `package_publisher` for non-admin connectors)
- The upstream MCP server URL, or enough information to evaluate one
- Client credentials for the target app (API key, OAuth client, service account)
- The API platform set to `http://shuvdex:3847` (or your deployment's API host)

```bash
export SHUVDEX_API=http://shuvdex:3847
export SHUVDEX_TOKEN=<your-platform-admin-token>
```

---

## Step 1 — Research: Find or Evaluate the Upstream MCP Server

Before registering, decide which adapter strategy to use:

| Strategy | When to use |
|----------|-------------|
| `mcp_proxy` → upstream vendor MCP server | Vendor publishes an MCP server and it passes quality review |
| `http_api` → OpenAPI-backed adapter | Vendor has a strong REST API but no strong MCP server |
| `module_runtime` → custom module | Bespoke system, complex normalization, or Custom tier requirement |

**Quality criteria for vendor MCP servers:**
- Tools have clear, unambiguous descriptions (no injection patterns)
- Input/output schemas are well-defined
- Authentication is documented and stable
- Server is actively maintained and versioned

If no vendor MCP exists, default to `http_api` using the vendor's REST API and OpenAPI spec.

Document your findings before proceeding.

---

## Step 2 — Register: Create the Upstream Record

Register the upstream with the shuvdex control plane. This creates the upstream record but does not
yet sync tools.

```bash
curl -s -X POST "$SHUVDEX_API/api/upstreams" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "upstreamId": "slack",
    "name": "Slack",
    "description": "Slack via Slack MCP server — messages, channels, search, user directory",
    "transport": "streamable-http",
    "endpoint": "https://slack.com/api/mcp",
    "namespace": "slack",
    "credentialId": "cred-slack-bot",
    "owner": "Latitudes",
    "purpose": "Team communication and search integration",
    "defaultActionClass": "read",
    "defaultRiskLevel": "medium"
  }' | jq .
```

**Expected response:**
```json
{
  "upstreamId": "slack",
  "status": "registered",
  "createdAt": "2026-04-04T10:00:00Z"
}
```

Save the `upstreamId` — you will use it in every subsequent step.

> **Tip:** Use the example JSON files in `docs/connectors/examples/` as your registration payload
> template. Each file contains the recommended defaults for that connector.

---

## Step 3 — Credential: Bind the Credential

Create the credential binding that the upstream will use for outbound auth. This is kept entirely
separate from inbound client auth.

```bash
curl -s -X POST "$SHUVDEX_API/api/credentials" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "credentialId": "cred-slack-bot",
    "upstreamId": "slack",
    "type": "api-key",
    "secret": {
      "botToken": "xoxb-xxxxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx"
    },
    "rotationIntervalDays": 90,
    "notes": "Slack Bot User OAuth Token — rotate every 90 days"
  }' | jq .
```

**Expected response:**
```json
{
  "credentialId": "cred-slack-bot",
  "upstreamId": "slack",
  "status": "active",
  "nextRotation": "2026-07-04T10:00:00Z"
}
```

> **Security note:** The `secret` payload is write-only — the API will never return credential
> values in subsequent reads. Treat the credential ID as a reference handle only.

---

## Step 4 — Sync: Discover Tools from Upstream

Trigger a capability sync. shuvdex will connect to the upstream MCP server, call `tools/list`,
and register each discovered tool in the local capability registry.

```bash
curl -s -X POST "$SHUVDEX_API/api/upstreams/slack/sync" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" | jq .
```

**Expected response:**
```json
{
  "upstreamId": "slack",
  "syncId": "sync-abc123",
  "status": "complete",
  "toolsDiscovered": 12,
  "toolsAdded": 12,
  "toolsChanged": 0,
  "toolsRemoved": 0,
  "syncedAt": "2026-04-04T10:01:00Z"
}
```

If `toolsDiscovered` is 0, check:
1. Upstream endpoint is reachable from the shuvdex host
2. Credential is valid and has the correct scopes
3. MCP server is running and responding to `tools/list`

Check the upstream health endpoint:

```bash
curl -s "$SHUVDEX_API/api/upstreams/slack/health" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" | jq .
```

---

## Step 5 — Classify: Review Auto-Classification

After sync, each tool has been auto-classified based on its name, description, and input schema.
Review the classifications — especially for write-capable and high-risk tools.

```bash
# List all tools for this upstream
curl -s "$SHUVDEX_API/api/upstreams/slack/tools" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" | jq '.tools[] | {name, actionClass, riskLevel, flagged}'
```

**Review checklist:**
- [ ] Every tool with `write`, `admin`, or `external` action class is correctly identified
- [ ] Any tool that creates, updates, or deletes data is classified as `write` or higher
- [ ] Financial data tools are classified as `high` or `restricted` risk
- [ ] PII-touching tools are classified as `medium` or higher risk
- [ ] No tools flagged for suspected injection patterns (check `flagged: true`)

Override a classification if it is incorrect:

```bash
curl -s -X PATCH "$SHUVDEX_API/api/upstreams/slack/tools/slack.post_message" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "actionClass": "write",
    "riskLevel": "high",
    "classificationNote": "Message posting has external side effects — upgraded to write/high"
  }' | jq .
```

---

## Step 6 — Pin: Hash-Pin All Tool Descriptions

Pin the current tool descriptions. This creates a SHA-256 hash of each tool's `name + description +
inputSchema`. If the upstream vendor ever mutates these fields, shuvdex will auto-disable the tool
and alert operators.

```bash
curl -s -X POST "$SHUVDEX_API/api/upstreams/slack/pin" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" | jq .
```

**Expected response:**
```json
{
  "upstreamId": "slack",
  "pinned": 12,
  "pinnedAt": "2026-04-04T10:02:00Z",
  "algorithm": "sha256"
}
```

> **Do not skip this step.** Description pinning is the primary defense against rug-pull attacks
> where a vendor MCP server mutates tool descriptions to inject instructions after approval.

---

## Step 7 — Approve: Set Package Approval for Target Tenants

The connector is not visible to any tenant until it is explicitly approved. Approve it per tenant.

```bash
# Approve for a specific tenant
curl -s -X POST "$SHUVDEX_API/api/tenants/acme-corp/packages" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "upstreamId": "slack",
    "status": "approved",
    "approvedBy": "operator@latitudes.io",
    "approvalNote": "Approved for ACME Corp — all staff read, comms team write to #announcements only",
    "effectiveFrom": "2026-04-04T00:00:00Z"
  }' | jq .
```

**Expected response:**
```json
{
  "tenantId": "acme-corp",
  "upstreamId": "slack",
  "status": "approved",
  "approvedAt": "2026-04-04T10:03:00Z"
}
```

For write-capable tools, approve at the individual tool level for the relevant role:

```bash
curl -s -X POST "$SHUVDEX_API/api/tenants/acme-corp/capabilities/slack.post_message/approve" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "approvedFor": ["communications"],
    "constraint": "channels: [\"announcements\", \"general\"]",
    "approvedBy": "operator@latitudes.io"
  }' | jq .
```

---

## Step 8 — Map: Update Role Mappings

Update the tenant's role mappings to include the new connector's tools for the appropriate groups.

```bash
curl -s -X PATCH "$SHUVDEX_API/api/tenants/acme-corp/policy/roles/all-staff" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "addCapabilities": [
      "slack.list_channels",
      "slack.get_message_history",
      "slack.search_messages",
      "slack.get_user"
    ]
  }' | jq .

curl -s -X PATCH "$SHUVDEX_API/api/tenants/acme-corp/policy/roles/communications" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "addCapabilities": [
      "slack.post_message"
    ]
  }' | jq .
```

---

## Step 9 — Test: Verify Tool Discovery and Execution

Test that the connector surfaces correctly from the tenant's MCP endpoint.

**Initialize an MCP session and list tools:**

```bash
# Initialize session
SESSION=$(curl -s -X POST "http://shuvdex:3848/mcp" \
  -H "Authorization: Bearer $TENANT_USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
  | jq -r '.result.sessionId // empty')

# List tools — verify Slack tools appear
curl -s -X POST "http://shuvdex:3848/mcp" \
  -H "Authorization: Bearer $TENANT_USER_TOKEN" \
  -H "MCP-Session-Id: $SESSION" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | jq '.result.tools[] | select(.name | startswith("slack")) | {name, description}'
```

**Run a test invocation:**

```bash
curl -s -X POST "http://shuvdex:3848/mcp" \
  -H "Authorization: Bearer $TENANT_USER_TOKEN" \
  -H "MCP-Session-Id: $SESSION" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "slack.list_channels",
      "arguments": {"limit": 5}
    }
  }' | jq '.result'
```

**Verify audit record was created:**

```bash
curl -s "$SHUVDEX_API/api/audit?tenantId=acme-corp&limit=5" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  | jq '.events[] | {eventId, actor, action, target, outcome}'
```

**Verify write tools are blocked for non-authorized roles:**

```bash
# This should return a policy deny for a standard user
curl -s -X POST "http://shuvdex:3848/mcp" \
  -H "Authorization: Bearer $STANDARD_USER_TOKEN" \
  -H "MCP-Session-Id: $SESSION2" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "name": "slack.post_message",
      "arguments": {"channel": "general", "text": "test"}
    }
  }' | jq '.error'
```

Expected: `{"code": -32603, "message": "Policy denied: write capability requires explicit role approval"}`

---

## Step 10 — Document: Update the Connector Catalog

Add the new connector to [`docs/connectors/catalog.md`](./catalog.md):

1. Add a row to the **Full Catalog** table with correct status, MCP server, transport, action classes, and namespace
2. Add a **Connector Detail** section with the capability table and role mapping recommendations
3. Add example registration JSON to `docs/connectors/examples/<connector-id>.json`
4. Note any operational caveats, rate limits, or rotation requirements

---

## Step 11 — Deploy: Notify Affected Tenants

When a new connector is available:

1. **Existing tenants** who could benefit: schedule a brief call or send a notification via the Latitudes client portal
2. **Onboarding tenants**: include the new connector in their configured integration set if it matches their stack
3. **Update the sales page** if the connector moves from Planned → Live
4. **Update pricing tier limits** if the new connector affects what counts toward Core/Standard limits

```bash
# Send notification to tenants with matching integration profiles
curl -s -X POST "$SHUVDEX_API/api/notifications/connector-available" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "upstreamId": "slack",
    "targetTenantFilter": "standard,custom",
    "message": "Slack connector is now available. Contact your Latitudes account manager to enable it."
  }' | jq .
```

---

## Connector Readiness Checklist

Before marking a connector as **Live**, verify all of the following:

### Research
- [ ] Adapter strategy decided and documented (mcp_proxy / http_api / module_runtime)
- [ ] Upstream MCP server or API quality reviewed
- [ ] Tool descriptions scanned for injection patterns — none found (or flagged tools reviewed and resolved)

### Registration
- [ ] Upstream record created with correct namespace, transport, and defaults
- [ ] Credential binding created and tested
- [ ] Capability sync completed — expected tool count discovered

### Classification
- [ ] All write/admin/external tools correctly classified
- [ ] Financial data tools marked high/restricted
- [ ] PII-touching tools marked medium or higher
- [ ] No tools with `flagged: true` remaining in unreviewed state

### Security
- [ ] All tool descriptions hash-pinned
- [ ] Mutation detection active (confirm with a test mutation if possible)
- [ ] Metadata injection scan completed

### Governance
- [ ] Package approved for at least one test tenant
- [ ] Role mappings defined for standard role set (all-staff, role-specific)
- [ ] Write tools approved only for appropriate roles

### Testing
- [ ] Tool list verified from tenant MCP endpoint
- [ ] At least one read tool invoked successfully with audit record confirmed
- [ ] Write tool blocked for non-authorized role (policy deny confirmed)
- [ ] Upstream health check returns OK

### Documentation
- [ ] Connector catalog updated with full detail section
- [ ] Example registration JSON added to `docs/connectors/examples/`
- [ ] Any operational caveats, rate limits, and rotation requirements documented
- [ ] `AGENTS.md` updated if this changes deployment shape

---

## Troubleshooting

| Symptom | Likely Cause | Resolution |
|---------|-------------|-----------|
| `toolsDiscovered: 0` after sync | Upstream unreachable or credential invalid | Check endpoint reachability, verify credential scopes |
| Tools appear but calls fail with 403 | Credential lacks required scopes | Expand OAuth scopes or API key permissions, re-sync |
| Tool not visible in tenant session | Package not approved for tenant, or tool not in role mapping | Step 7 (approve) and Step 8 (role map) |
| Write tool visible when it shouldn't be | Action class not correctly set | Override via `PATCH /api/upstreams/:id/tools/:tool` |
| `flagged: true` on tool description | Injection scanner detected suspicious pattern | Review description manually; override with justification if false positive |
| Auto-disable triggered after sync | Description mutation detected — hash changed | Compare old and new description; if benign upstream update, re-pin after review |
| Audit records missing | Audit pipeline misconfigured | Check OTEL exporter configuration; verify `/api/audit` returns events for other tools |
