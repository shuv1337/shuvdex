# Connection Maintenance Runbook

## Overview

Shuvdex proxies upstream MCP servers on behalf of tenants. Upstream APIs change over time —
tool names may be renamed, descriptions updated, input schemas revised, or servers retired.
This runbook covers how to detect, respond to, and communicate upstream API changes.

---

## 1. Upstream API Change Detection

### Automatic Detection

Shuvdex detects upstream changes during every capability sync:

- **New tools:** added to the cache; `CapabilitySyncResult.added` is non-empty
- **Removed tools:** removed from the cache; `CapabilitySyncResult.removed` is non-empty
- **Changed tools:** description hash mismatch; `CapabilitySyncResult.changed` is non-empty
- **Mutation detected:** pinned hash differs from current hash; upstream automatically moved to
  `trustState: "suspended"` and tool calls blocked

### Manual Detection

```bash
# Check all upstream health and mutation status
./scripts/ops/upstream-health-check.sh

# Check a specific upstream for mutations
curl -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  http://localhost:3847/api/upstreams/<upstream-id>/mutations | jq .

# View sync history via audit log
./scripts/ops/audit-search.sh --action "tool_call" --upstream <upstream-id> --limit 50
```

---

## 2. Responding to an Upstream API Change

When a sync reveals an upstream has changed, follow this procedure:

### Step 1: Detect via Sync Health Check

```bash
# Trigger a sync for all upstreams and capture the result
./scripts/ops/upstream-health-check.sh --sync --json | jq '.upstreams[] | select(.changed | length > 0)'
```

Alternatively, review the governance dashboard at `http://<host>/dashboard` — the Connected
Integrations section shows sync timestamps and health status.

### Step 2: Re-Sync Capabilities

```bash
# Sync a specific upstream
curl -X POST \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  http://localhost:3847/api/upstreams/<upstream-id>/sync | jq .
```

Review the sync result:

```json
{
  "added": ["new_tool_name"],
  "removed": ["old_tool_name"],
  "changed": ["existing_tool"],
  "mutationDetected": true,
  "mutatedTools": ["existing_tool"]
}
```

### Step 3: Check for Mutations

If `mutationDetected` is `true`, the upstream has been automatically suspended:

```bash
# View mutation details
curl -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  http://localhost:3847/api/upstreams/<upstream-id> | jq '{trustState, healthStatus, toolCount}'

# List which tools mutated
curl -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  http://localhost:3847/api/upstreams/<upstream-id>/mutations | jq '.mutated[].name'
```

**Assess the mutation:**

| Change type | Risk level | Action required |
|-------------|-----------|----------------|
| Cosmetic description reword | Low | Re-approve and re-pin |
| Schema field added (backward-compatible) | Low–medium | Review and re-pin |
| Schema field removed or renamed | Medium | Review, test, re-approve |
| Description contains new instructions | High | Security review before re-approval |
| Description contains injection patterns | **Critical** | Block; escalate to security team |

### Step 4: Update Tool Classifications if Needed

If a tool's action class or risk level has changed based on the new description or schema:

```bash
# Update the upstream's default action class (applies to future syncs)
curl -X PATCH \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"defaultActionClass": "write", "defaultRiskLevel": "medium"}' \
  http://localhost:3847/api/upstreams/<upstream-id>
```

Then re-sync to apply the new classification to cached tools.

### Step 5: Re-Pin Descriptions

After reviewing and approving the new tool descriptions:

```bash
# Pin all tools in the upstream (mark current hashes as approved)
curl -X POST \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}' \
  http://localhost:3847/api/upstreams/<upstream-id>/pin

# Pin specific tools only
curl -X POST \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"toolNames": ["existing_tool"]}' \
  http://localhost:3847/api/upstreams/<upstream-id>/pin
```

### Step 6: Restore Upstream Trust State

After pinning, manually restore the trust state if the mutation was benign:

```bash
curl -X PATCH \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"trustState": "trusted"}' \
  http://localhost:3847/api/upstreams/<upstream-id>
```

> **Note:** A suspended upstream means all tool calls from that upstream return errors.
> Restore trust only after completing the security review and re-pinning.

### Step 7: Notify Affected Tenants

Identify which tenants use the changed upstream:

```bash
# Find packages linked to this upstream
curl -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  "http://localhost:3847/api/packages?upstreamId=<upstream-id>" | jq '.[].id'

# Find tenants with active approvals for those packages
for pkg in $(curl -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  "http://localhost:3847/api/packages?upstreamId=<upstream-id>" | jq -r '.[].id'); do
  curl -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
    "http://localhost:3847/api/tenants?packageId=${pkg}" | jq '.[].owner.email'
done
```

Notify affected tenants via email or the client communication channel with:
- What changed (tool name, description, schema)
- Whether the change is backward-compatible
- When the change will take effect
- Any action required on their side (e.g. update system prompts that reference tool names)

---

## 3. Maintenance Window Procedures

### Planned Maintenance

For planned upstream downtime (e.g. vendor maintenance):

```bash
# 1. Mark the upstream as suspended proactively
curl -X PATCH \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"trustState": "suspended", "healthStatus": "unhealthy"}' \
  http://localhost:3847/api/upstreams/<upstream-id>

# 2. After maintenance: trigger a sync to confirm the upstream is back
curl -X POST \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  http://localhost:3847/api/upstreams/<upstream-id>/sync

# 3. Restore trust state
curl -X PATCH \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"trustState": "trusted"}' \
  http://localhost:3847/api/upstreams/<upstream-id>
```

### Emergency Kill Switch

If an upstream is actively misbehaving and needs immediate isolation:

```bash
./scripts/ops/kill-switch.sh --upstream <upstream-id>
```

See the kill switch runbook for full details.

---

## 4. Connector Deprecation Lifecycle

When an upstream vendor discontinues a tool or service:

| Phase | Action | Timeline |
|-------|--------|---------|
| Detected | Mark upstream tools with `enabled: false` | Day 0 |
| Communication | Notify affected tenants | Day 0–3 |
| Migration | Help tenants migrate to replacement | 30–90 days |
| Deprecation | Set package `enabled: false`; retain for audit | 90 days |
| Archive | Remove from active upstream list | 180 days |

```bash
# Disable specific capabilities without removing them
curl -X POST \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  http://localhost:3847/api/capabilities/<capability-id>/disable

# Disable an entire package
curl -X PATCH \
  -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}' \
  http://localhost:3847/api/packages/<package-id>
```

---

## 5. Health Alerting Setup

### Alerting Thresholds

| Condition | Severity | Auto-action |
|-----------|----------|------------|
| Upstream health = `unhealthy` for > 5 min | Warning | Alert |
| Upstream health = `unhealthy` for > 30 min | Critical | Alert + PagerDuty |
| Mutation detected on any upstream | Critical | Auto-suspend + Alert |
| Sync not run for > 48 hours | Warning | Alert |
| Audit error rate > 10% (1h window) | Warning | Alert |
| Audit error rate > 25% (1h window) | Critical | Alert + PagerDuty |

### Setting Up Alerting

Use the health check script with monitoring integration:

```bash
# Prometheus/Grafana: output health as metrics
./scripts/ops/upstream-health-check.sh --json | \
  jq -r '.upstreams[] | "shuvdex_upstream_health{upstream=\"\(.upstreamId)\"} \(if .healthStatus == "healthy" then 1 else 0 end)"'

# Slack webhook alert (add to cron every 5 minutes)
*/5 * * * * /opt/shuvdex/scripts/ops/upstream-health-check.sh --quiet || \
  curl -X POST "${SLACK_WEBHOOK}" \
    -H "Content-Type: application/json" \
    -d "{\"text\": \"🚨 shuvdex upstream health check failed on $(hostname)\"}"
```

### Monitoring Dashboard

The governance dashboard at `http://<host>/dashboard` shows:
- Real-time upstream health with badges
- Last sync timestamps
- Trust state for each upstream
- Audit timeline and error rates

---

## 6. Regular Maintenance Schedule

| Task | Frequency | Script |
|------|-----------|--------|
| Sync all upstreams | Daily | Scheduled via API or cron |
| Check for mutations | Daily | `./scripts/ops/upstream-health-check.sh` |
| Review audit error rates | Weekly | Governance dashboard |
| Rotate credentials | Per SLA (default 90 days) | `./scripts/ops/rotate-credential.sh` |
| Test backup integrity | Monthly | `./scripts/ops/backup.sh --verify` |
| Review package certifications | Quarterly | Manual audit |
| Full connection test | Quarterly | `./scripts/run-mcp-certification.sh` |
