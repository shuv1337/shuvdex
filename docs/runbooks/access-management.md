# Runbook: Access Management

Access control in shuvdex is implemented through:

1. **Tokens** — issued JWTs that carry a `subjectId`, `subjectType`, scopes, and package allow/deny lists
2. **Policies** — named rules that define which packages and capabilities a token may access, and at what risk level

When an MCP request arrives, the token is verified and its claims are matched against active policies. The resulting authorization decision — allow/deny with reason — is recorded in the audit log.

**Base URL:** `http://localhost:3847` (override with `SHUVDEX_API_URL`)
**Auth header:** `Authorization: Bearer <token>` (required when auth is enabled)

---

## Contents

1. [Issue a default operator token](#1-issue-a-default-operator-token)
2. [Issue a token with specific scopes and roles](#2-issue-a-token-with-specific-scopes-and-roles)
3. [Issue a scoped read-only token](#3-issue-a-scoped-read-only-token)
4. [Verify a token](#4-verify-a-token)
5. [Revoke a token](#5-revoke-a-token)
6. [Create a policy to restrict package access](#6-create-a-policy-to-restrict-package-access)
7. [Create a policy for role-based access (scopes)](#7-create-a-policy-for-role-based-access-scopes)
8. [Create a policy that limits risk level](#8-create-a-policy-that-limits-risk-level)
9. [List all policies](#9-list-all-policies)
10. [Delete a policy](#10-delete-a-policy)
11. [View the audit trail for a subject](#11-view-the-audit-trail-for-a-subject)

---

## 1. Issue a default operator token

An operator token with full `admin` scope, valid for 24 hours:

```bash
curl -s -X POST http://localhost:3847/api/tokens \
  -H "Content-Type: application/json" \
  -d '{
    "subjectType": "user",
    "subjectId": "operator@latitudes.io",
    "scopes": ["admin"],
    "ttlSeconds": 86400
  }' | jq .
```

**Response:**
```json
{
  "token": "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9...",
  "claims": {
    "jti": "01J...",
    "subjectType": "user",
    "subjectId": "operator@latitudes.io",
    "scopes": ["admin"],
    "issuedAt": 1743811200,
    "expiresAt": 1743897600,
    ...
  }
}
```

The `jti` (JWT ID) is the value used for revocation. Save it if you anticipate needing to revoke this token before expiry.

For the operator token script, see `scripts/ops/issue-operator-token.sh`.

---

## 2. Issue a token with specific scopes and roles

Subject types:
- `user` — human operator or end user
- `host` — an AI host (Claude Desktop, Cursor, etc.)
- `install` — a deployed shuvdex client installation
- `service` — a service account or automation

Available scopes (defined by policies):
- `admin` — full access, all packages
- `skill:read` — read-only access to skill tools
- `skill:apply` — can invoke skill tools
- Custom scopes defined in your policies

```bash
curl -s -X POST http://localhost:3847/api/tokens \
  -H "Content-Type: application/json" \
  -d '{
    "subjectType": "host",
    "subjectId": "claude-desktop-workstation-1",
    "scopes": ["skill:read", "skill:apply"],
    "hostTags": ["desktop", "internal"],
    "clientTags": ["claude"],
    "ttlSeconds": 2592000
  }' | jq .
```

---

## 3. Issue a scoped read-only token

A token restricted to specific packages, valid for 8 hours:

```bash
curl -s -X POST http://localhost:3847/api/tokens \
  -H "Content-Type: application/json" \
  -d '{
    "subjectType": "user",
    "subjectId": "analyst@example.com",
    "scopes": ["skill:read"],
    "allowedPackages": [
      "openapi.gitea.api",
      "skill.module_runtime_template"
    ],
    "ttlSeconds": 28800
  }' | jq .
```

A token with `allowedPackages` will only be able to access those specific packages, regardless of any active allow-all policies.

---

## 4. Verify a token

Check that a token is valid and see its current claims (also confirms it has not been revoked):

```bash
curl -s -X POST http://localhost:3847/api/tokens/verify \
  -H "Content-Type: application/json" \
  -d '{"token": "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9..."}' | jq .
```

Returns `TokenClaims` on success, or an error if the token is invalid, expired, or revoked.

---

## 5. Revoke a token

Revocation is immediate and persistent. The `jti` (JWT ID) is found in the `claims.jti` field of the issue response:

```bash
curl -s -X POST http://localhost:3847/api/tokens/revoke \
  -H "Content-Type: application/json" \
  -d '{"jti": "01J..."}' | jq .
```

> To revoke all tokens for a subject (e.g. a compromised account), you must revoke each `jti` individually. Cross-reference the audit log to find all `jti` values issued to a subject, or see [incident-response.md](./incident-response.md) for the emergency procedure.

---

## 6. Create a policy to restrict package access

Policies use `PUT` (upsert). The policy `id` is the path parameter:

```bash
curl -s -X PUT http://localhost:3847/api/policies/finance-read-only \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Finance team: read-only access to accounting tools",
    "scopes": ["skill:read"],
    "allowPackages": [
      "openapi.quickbooks.api",
      "openapi.xero.api"
    ],
    "denyPackages": [],
    "allowCapabilities": [],
    "denyCapabilities": []
  }' | jq .
```

**Policy fields:**
- `scopes` — which token scopes this policy applies to
- `hostTags` — apply only when the token has these host tags
- `clientTags` — apply only when the token has these client tags
- `allowPackages` — explicit package allow list (empty = allow all packages that pass scope check)
- `denyPackages` — packages explicitly blocked
- `allowCapabilities` — explicit capability (tool) allow list
- `denyCapabilities` — capabilities explicitly blocked
- `maxRiskLevel` — `low`, `medium`, or `high` (capabilities above this level are denied)

---

## 7. Create a policy for role-based access (scopes)

Define what a scope can access by combining scopes with package/capability restrictions:

```bash
# Marketing team: HubSpot + Mailchimp, no write tools
curl -s -X PUT http://localhost:3847/api/policies/marketing-standard \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Marketing team standard access",
    "scopes": ["marketing:read", "marketing:apply"],
    "allowPackages": [
      "openapi.hubspot.api",
      "openapi.mailchimp.api"
    ],
    "maxRiskLevel": "low"
  }' | jq .
```

```bash
# Internal developer: all skills, no external API keys
curl -s -X PUT http://localhost:3847/api/policies/developer-internal \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Developer internal access: skills only",
    "scopes": ["skill:read", "skill:apply"],
    "allowPackages": [],
    "denyCapabilities": []
  }' | jq .
```

---

## 8. Create a policy that limits risk level

Restrict a scope to low-risk capabilities only:

```bash
curl -s -X PUT http://localhost:3847/api/policies/low-risk-only \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Restrict to low-risk capabilities only (public demo accounts)",
    "scopes": ["demo:read"],
    "maxRiskLevel": "low"
  }' | jq .
```

Risk levels on capabilities are defined in `capability.yaml`:
- `low` — read-only, no side effects, public data
- `medium` — standard API access, may modify non-critical data
- `high` — modifies sensitive data, financial operations, admin actions

---

## 9. List all policies

```bash
curl -s http://localhost:3847/api/policies | jq .
```

To see which packages each policy allows:
```bash
curl -s http://localhost:3847/api/policies | \
  jq '.[] | {id, scopes, allowPackages, maxRiskLevel}'
```

---

## 10. Delete a policy

```bash
curl -s -X DELETE http://localhost:3847/api/policies/finance-read-only | jq .
```

> **Note:** Deleting a policy does not revoke existing tokens. Tokens that matched this policy will fall through to other matching policies on the next request. If the intent is to cut off access immediately, revoke the affected tokens.

---

## 11. View the audit trail for a subject

The audit log records every `list_tools`, `call_tool`, `list_resources`, and related event with the decision (allow/deny) and reason:

```bash
# All audit events
curl -s http://localhost:3847/api/audit | jq .

# Events for a specific subject
curl -s http://localhost:3847/api/audit | \
  jq '[.[] | select(.subjectId == "operator@latitudes.io")]'

# Only denied events (authorization failures)
curl -s http://localhost:3847/api/audit | \
  jq '[.[] | select(.decision == "deny")]'

# Denied events for a specific subject
curl -s http://localhost:3847/api/audit | \
  jq '[.[] | select(.subjectId == "user@example.com" and .decision == "deny")]'

# Events involving a specific capability
curl -s http://localhost:3847/api/audit | \
  jq '[.[] | select(.capabilityId == "openapi.quickbooks.api.createInvoice")]'
```

For the audit search script with filtering, see `scripts/ops/audit-search.sh`.

---

## Quick reference

| Action | Method | Path |
|--------|--------|------|
| Issue token | POST | `/api/tokens` |
| Verify token | POST | `/api/tokens/verify` |
| Revoke token | POST | `/api/tokens/revoke` |
| List policies | GET | `/api/policies` |
| Upsert policy | PUT | `/api/policies/:policyId` |
| Delete policy | DELETE | `/api/policies/:policyId` |
| List audit events | GET | `/api/audit` |

---

## Token TTL guidelines

| Use case | Recommended TTL |
|----------|----------------|
| Operator scripts | `3600` (1 hour) |
| AI host (desktop app) | `2592000` (30 days) |
| CI/CD service account | `86400` (24 hours) |
| Emergency investigation | `1800` (30 min) |
| Long-lived service token | `7776000` (90 days) — rotate regularly |

---

## See also

- [incident-response.md](./incident-response.md) — revoking all tokens for a compromised identity
- [credential-management.md](./credential-management.md) — managing outbound API credentials
- [operator-guide.md](../operator-guide.md) — day-to-day operations overview
