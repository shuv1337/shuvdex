# Runbook: Incident Response

This runbook covers emergency procedures for common security and operational incidents. All actions take effect immediately on the running server — no restart required.

**Base URL:** `http://localhost:3847` (override with `SHUVDEX_API_URL`)
**MCP URL:** `http://localhost:3848/mcp`

> ⚠️ **In an emergency, speed matters.** Each section below starts with the fastest path to containment, followed by investigation and recovery steps.

---

## Contents

1. [Kill switch: disable a specific tool immediately](#1-kill-switch-disable-a-specific-tool-immediately)
2. [Kill switch: disable an entire package immediately](#2-kill-switch-disable-an-entire-package-immediately)
3. [Revoke all tokens for a compromised identity](#3-revoke-all-tokens-for-a-compromised-identity)
4. [Emergency package deletion](#4-emergency-package-deletion)
5. [Audit investigation: trace a specific request](#5-audit-investigation-trace-a-specific-request)
6. [Upstream failure handling](#6-upstream-failure-handling)
7. [Post-incident recovery](#7-post-incident-recovery)

---

## 1. Kill switch: disable a specific tool immediately

Use this when a single capability is behaving unexpectedly, generating errors, or is the subject of a security concern.

```bash
TOOL_ID="openapi.quickbooks.api.createInvoice"

curl -s -X POST "http://localhost:3847/api/tools/${TOOL_ID}/disable" | jq .
```

Confirm the tool is disabled:
```bash
curl -s "http://localhost:3847/api/tools/${TOOL_ID}" | jq .enabled
```

Expected: `false`

The tool is immediately removed from the MCP tool list on the next `tools/list` call. Existing AI sessions that have already cached the tool list will not be able to invoke it — the capability check happens at invocation time, not at discovery time.

For the kill-switch script, see `scripts/ops/kill-switch.sh`.

---

## 2. Kill switch: disable an entire package immediately

When a whole package needs to be shut down — all its capabilities disabled at once:

```bash
PKG_ID="openapi.quickbooks.api"

# Disable all capabilities in the package
curl -s http://localhost:3847/api/packages | \
  jq -r --arg id "$PKG_ID" \
    '.[] | select(.id == $id) | .capabilities[].id' | \
  while read -r cap_id; do
    echo "Disabling $cap_id..."
    curl -s -X POST "http://localhost:3847/api/tools/${cap_id}/disable" | \
      jq -r '"  \(.id): enabled=\(.enabled)"'
  done
```

Confirm all capabilities are disabled:
```bash
curl -s http://localhost:3847/api/tools | \
  jq --arg id "$PKG_ID" \
    '[.[] | select(.id | startswith($id))] | {count: length, enabled: [.[] | select(.enabled)]}'
```

Expected: `enabled: []`

For the kill-switch script that handles both tools and packages, see `scripts/ops/kill-switch.sh`.

---

## 3. Revoke all tokens for a compromised identity

**Step 1:** Find all audit events for the compromised subject to understand the blast radius:

```bash
SUBJECT="compromised-user@example.com"

curl -s http://localhost:3847/api/audit | \
  jq --arg s "$SUBJECT" \
    '[.[] | select(.subjectId == $s)] | {
      total: length,
      allowed: [.[] | select(.decision == "allow")] | length,
      denied: [.[] | select(.decision == "deny")] | length,
      tools_called: [.[] | select(.action == "call_tool") | .capabilityId] | unique
    }'
```

**Step 2:** Revoke each known token `jti` for this subject.

If you have the JTI values (from token issuance records):
```bash
for jti in "01J..." "01K..." "01L..."; do
  echo "Revoking $jti..."
  curl -s -X POST http://localhost:3847/api/tokens/revoke \
    -H "Content-Type: application/json" \
    -d "{\"jti\": \"${jti}\"}" | jq .
done
```

If you do not have the JTI values: tokens are self-contained JWTs. The fastest path to full containment without the JTI list is to:

1. Identify and block the subject at the policy level:
   ```bash
   curl -s -X PUT "http://localhost:3847/api/policies/deny-compromised-${SUBJECT//[@.]/-}" \
     -H "Content-Type: application/json" \
     -d "{
       \"description\": \"Emergency deny — compromised account ${SUBJECT}\",
       \"scopes\": [],
       \"hostTags\": [],
       \"clientTags\": [],
       \"denyPackages\": [],
       \"denyCapabilities\": []
     }" | jq .
   ```
   
   > **Note:** Per-subject deny is not currently enforced at the policy level — policies match on scopes and tags, not subject IDs. If you have the token's JTI, revoke it directly. If not, disable the specific packages or capabilities the compromised token could access while you investigate.

2. Disable the packages the compromised token had access to (if scope is known):
   ```bash
   # Example: disable all capabilities in the known-accessed packages
   for pkg in "openapi.quickbooks.api" "openapi.hubspot.api"; do
     echo "Disabling package: $pkg"
     curl -s http://localhost:3847/api/packages | \
       jq -r --arg id "$pkg" '.[] | select(.id == $id) | .capabilities[].id' | \
       while read -r cap_id; do
         curl -s -X POST "http://localhost:3847/api/tools/${cap_id}/disable" >/dev/null
         echo "  Disabled: $cap_id"
       done
   done
   ```

**Step 3:** After containment, investigate the full audit trail:
```bash
curl -s http://localhost:3847/api/audit | \
  jq --arg s "$SUBJECT" \
    '[.[] | select(.subjectId == $s)] | sort_by(.timestamp)'
```

**Step 4:** Re-enable packages after the incident is resolved and new tokens have been issued.

---

## 4. Emergency package deletion

When a package must be completely removed from the registry (e.g. the upstream API is shut down, a skill is found to have a security vulnerability):

```bash
PKG_ID="openapi.compromised.api"

curl -s -X DELETE "http://localhost:3847/api/packages/${PKG_ID}" | jq .
```

For local repo packages, deletion from the registry persists only until the next reindex. To permanently prevent re-registration:

```bash
# Remove the capability.yaml from the local repo
rm -rf skills/compromised-skill/

# Reindex to confirm it's gone
curl -s -X POST http://localhost:3847/api/packages/reindex | \
  jq '.artifacts[] | select(.package.id == "skill.compromised_skill")'
# Should return nothing
```

For an OpenAPI source, delete both the source and its generated package:

```bash
SOURCE_ID="compromised-api"

# Delete the source (also removes the generated package)
curl -s -X DELETE "http://localhost:3847/api/sources/openapi/${SOURCE_ID}" | jq .

# Verify the package is gone
curl -s http://localhost:3847/api/packages | \
  jq '[.[] | select(.id | startswith("openapi.compromised"))]'
```

---

## 5. Audit investigation: trace a specific request

When a specific tool call needs to be investigated:

```bash
# Find all tool call events in the last N events
curl -s http://localhost:3847/api/audit | \
  jq '[.[] | select(.action == "call_tool")] | reverse | .[0:20]'

# Find events for a specific capability
curl -s http://localhost:3847/api/audit | \
  jq '[.[] | select(.capabilityId == "openapi.quickbooks.api.createInvoice")]'

# Find all events in a time window (ISO 8601)
curl -s http://localhost:3847/api/audit | \
  jq '[.[] | select(
    .timestamp >= "2026-04-04T00:00:00Z" and
    .timestamp <= "2026-04-04T06:00:00Z"
  )]'

# Find denied events across all subjects
curl -s http://localhost:3847/api/audit | \
  jq '[.[] | select(.decision == "deny")] | group_by(.reason) | map({reason: .[0].reason, count: length})'

# Full timeline for a subject
curl -s http://localhost:3847/api/audit | \
  jq --arg s "subject@example.com" \
    '[.[] | select(.subjectId == $s)] | sort_by(.timestamp) | .[] | {timestamp, action, capabilityId, decision, reason}'
```

For the audit search script, see `scripts/ops/audit-search.sh`.

---

## 6. Upstream failure handling

When an upstream API (OpenAPI source) starts returning errors:

**Step 1:** Test the auth:
```bash
curl -s -X POST http://localhost:3847/api/sources/openapi/my-source/test-auth | jq .
```

**Step 2:** If auth fails, the credential may have expired or been revoked:
- Rotate the credential: see [credential-management.md](./credential-management.md#7-rotate-a-credential)
- If credentials cannot be renewed immediately, disable the source's package:
  ```bash
  curl -s http://localhost:3847/api/packages | \
    jq -r '.[] | select(.source.sourceId == "my-source") | .capabilities[].id' | \
    while read -r cap_id; do
      curl -s -X POST "http://localhost:3847/api/tools/${cap_id}/disable" >/dev/null
      echo "Disabled: $cap_id"
    done
  ```

**Step 3:** If the upstream API is down or unreachable, disable the package to prevent users from seeing failing tools:
```bash
# Find and disable capabilities from the failing source
SOURCE_ID="my-source"
curl -s http://localhost:3847/api/packages | \
  jq -r --arg src "$SOURCE_ID" \
    '.[] | select(.source.sourceId == $src) | .id'
```

**Step 4:** When the upstream recovers, test auth and refresh the source:
```bash
curl -s -X POST http://localhost:3847/api/sources/openapi/my-source/test-auth | jq .
curl -s -X POST http://localhost:3847/api/sources/openapi/my-source/refresh | jq .

# Re-enable capabilities
curl -s http://localhost:3847/api/tools | \
  jq -r '[.[] | select(.enabled == false)] | .[].id' | \
  while read -r cap_id; do
    # Only re-enable the ones you disabled
    echo "Consider re-enabling: $cap_id"
  done
```

---

## 7. Post-incident recovery

After an incident is contained and resolved:

1. **Re-enable disabled packages/capabilities** using the same tool IDs that were disabled.

2. **Issue fresh tokens** for affected subjects with tighter TTLs:
   ```bash
   curl -s -X POST http://localhost:3847/api/tokens \
     -H "Content-Type: application/json" \
     -d '{
       "subjectType": "user",
       "subjectId": "reinstated-user@example.com",
       "scopes": ["skill:read"],
       "ttlSeconds": 3600
     }' | jq .
   ```

3. **Review the full audit log** for the incident window and document findings.

4. **Review and update policies** if the incident revealed gaps in access controls.

5. **Remove emergency deny policies** created during containment:
   ```bash
   curl -s -X DELETE http://localhost:3847/api/policies/deny-emergency-xyz | jq .
   ```

6. **Run the certification harness** to confirm the system is operating normally:
   ```bash
   ./scripts/run-mcp-certification.sh
   ```

7. **Update this runbook** with any new procedures discovered during the incident.

---

## Quick reference: containment commands

| Situation | Command |
|-----------|---------|
| Disable one tool | `curl -sX POST .../api/tools/<id>/disable` |
| Disable all tools in a package | Iterate package capabilities, disable each |
| Revoke a specific token | `curl -sX POST .../api/tokens/revoke -d '{"jti":"..."}'` |
| Delete a package | `curl -sX DELETE .../api/packages/<id>` |
| Delete an OpenAPI source | `curl -sX DELETE .../api/sources/openapi/<id>` |
| Full audit for a subject | `GET /api/audit` + `jq` filter on `subjectId` |

See `scripts/ops/kill-switch.sh` for the automated emergency disable script.

---

## See also

- [access-management.md](./access-management.md) — token and policy management
- [package-lifecycle.md](./package-lifecycle.md) — package enable/disable operations
- [operator-guide.md](../operator-guide.md) — day-to-day operations and escalation
