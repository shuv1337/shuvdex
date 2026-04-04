# Runbook: Credential Management

Credentials are stored encrypted in `.capabilities/credentials/` and referenced by ID. They are never returned in full by the API — all list and get endpoints return redacted records with scheme type but no secret values.

Supported credential types:
- `api_key` — API key in header, query param, or cookie
- `bearer` — Bearer token in `Authorization: Bearer` header
- `basic` — HTTP Basic Auth (username + password)
- `oauth2_client_credentials` — OAuth 2.0 machine-to-machine flow
- `custom_headers` — arbitrary key-value headers

**Base URL:** `http://localhost:3847` (override with `SHUVDEX_API_URL`)
**Auth header:** `Authorization: Bearer <token>` (required when auth is enabled)

> ⚠️ **Security:** Secret values are only accepted on write. Treat `credentialId` references as stable identifiers — do not embed raw secrets in scripts or source control.

---

## Contents

1. [List all credentials](#1-list-all-credentials)
2. [Create an API key credential](#2-create-an-api-key-credential)
3. [Create a Bearer token credential](#3-create-a-bearer-token-credential)
4. [Create an OAuth2 client credentials credential](#4-create-an-oauth2-client-credentials-credential)
5. [Create a Basic Auth credential](#5-create-a-basic-auth-credential)
6. [Create a custom headers credential](#6-create-a-custom-headers-credential)
7. [Rotate a credential](#7-rotate-a-credential)
8. [Delete a credential](#8-delete-a-credential)
9. [Audit credential access](#9-audit-credential-access)

---

## 1. List all credentials

Returns redacted records — scheme type visible, secret values never returned:

```bash
curl -s http://localhost:3847/api/credentials | jq .
```

**Response fields:**
- `credentialId` — stable identifier
- `description` — human-readable label
- `schemeType` — one of `api_key`, `bearer`, `basic`, `oauth2_client_credentials`, `custom_headers`
- `sourceId` — OpenAPI source this credential is bound to (if any)
- `packageId` — package this credential is bound to (if any)
- `createdAt` / `updatedAt` — ISO 8601 timestamps

---

## 2. Create an API key credential

### In a header (most common)

```bash
curl -s -X POST http://localhost:3847/api/credentials \
  -H "Content-Type: application/json" \
  -d '{
    "credentialId": "dnsfilter-api-key",
    "description": "DNSFilter API key — production",
    "scheme": {
      "type": "api_key",
      "in": "header",
      "name": "Authorization",
      "value": "Token YOUR_API_KEY_HERE"
    }
  }' | jq .
```

### In a query parameter

```bash
curl -s -X POST http://localhost:3847/api/credentials \
  -H "Content-Type: application/json" \
  -d '{
    "credentialId": "analytics-key",
    "description": "Analytics API query key",
    "scheme": {
      "type": "api_key",
      "in": "query",
      "name": "apikey",
      "value": "YOUR_API_KEY"
    }
  }' | jq .
```

### In a cookie

```bash
curl -s -X POST http://localhost:3847/api/credentials \
  -H "Content-Type: application/json" \
  -d '{
    "credentialId": "session-cookie",
    "description": "Session cookie auth",
    "scheme": {
      "type": "api_key",
      "in": "cookie",
      "name": "session",
      "value": "YOUR_SESSION_VALUE"
    }
  }' | jq .
```

---

## 3. Create a Bearer token credential

```bash
curl -s -X POST http://localhost:3847/api/credentials \
  -H "Content-Type: application/json" \
  -d '{
    "credentialId": "hubspot-bearer",
    "description": "HubSpot private app access token",
    "scheme": {
      "type": "bearer",
      "token": "YOUR_BEARER_TOKEN_HERE"
    }
  }' | jq .
```

The token is sent as `Authorization: Bearer YOUR_BEARER_TOKEN_HERE` on outbound requests.

---

## 4. Create an OAuth2 client credentials credential

For machine-to-machine OAuth 2.0 flows (client ID + client secret → access token):

```bash
curl -s -X POST http://localhost:3847/api/credentials \
  -H "Content-Type: application/json" \
  -d '{
    "credentialId": "quickbooks-oauth",
    "description": "QuickBooks Online OAuth 2.0 client credentials",
    "scheme": {
      "type": "oauth2_client_credentials",
      "tokenUrl": "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      "clientId": "YOUR_CLIENT_ID",
      "clientSecret": "YOUR_CLIENT_SECRET",
      "scopes": ["com.intuit.quickbooks.accounting"]
    }
  }' | jq .
```

shuvdex fetches and caches an access token automatically. The token is refreshed when it expires.

---

## 5. Create a Basic Auth credential

```bash
curl -s -X POST http://localhost:3847/api/credentials \
  -H "Content-Type: application/json" \
  -d '{
    "credentialId": "internal-api-basic",
    "description": "Internal service basic auth",
    "scheme": {
      "type": "basic",
      "username": "service-account",
      "password": "YOUR_PASSWORD"
    }
  }' | jq .
```

---

## 6. Create a custom headers credential

For APIs that use non-standard authentication headers:

```bash
curl -s -X POST http://localhost:3847/api/credentials \
  -H "Content-Type: application/json" \
  -d '{
    "credentialId": "legacy-api-headers",
    "description": "Legacy API with custom auth headers",
    "scheme": {
      "type": "custom_headers",
      "headers": {
        "X-API-Key": "YOUR_KEY",
        "X-Client-ID": "YOUR_CLIENT_ID",
        "X-Signature": "YOUR_SIGNATURE"
      }
    }
  }' | jq .
```

---

## 7. Rotate a credential

Credential rotation involves three steps: create the new credential, update all references, then delete the old credential.

**Step 1:** Create the replacement credential with a new ID:

```bash
curl -s -X POST http://localhost:3847/api/credentials \
  -H "Content-Type: application/json" \
  -d '{
    "credentialId": "dnsfilter-api-key-v2",
    "description": "DNSFilter API key — rotated 2026-04-04",
    "scheme": {
      "type": "api_key",
      "in": "header",
      "name": "Authorization",
      "value": "Token YOUR_NEW_API_KEY_HERE"
    }
  }' | jq .
```

**Step 2:** Update all sources that reference the old credential:

```bash
# Find sources using the old credential
curl -s http://localhost:3847/api/sources/openapi | \
  jq -r '.[] | select(.credentialId == "dnsfilter-api-key") | .sourceId'

# Update each source
curl -s -X PATCH http://localhost:3847/api/sources/openapi/dnsfilter-api \
  -H "Content-Type: application/json" \
  -d '{"credentialId": "dnsfilter-api-key-v2"}' | jq .
```

**Step 3:** Verify the new credential works:

```bash
curl -s -X POST http://localhost:3847/api/sources/openapi/dnsfilter-api/test-auth | jq .
```

**Step 4:** Delete the old credential:

```bash
curl -s -X DELETE http://localhost:3847/api/credentials/dnsfilter-api-key | jq .
```

> For the automated rotation script, see `scripts/ops/rotate-credential.sh`.

---

## 8. Delete a credential

```bash
curl -s -X DELETE http://localhost:3847/api/credentials/dnsfilter-api-key | jq .
```

> **Warning:** Deleting a credential that is still referenced by a source will cause that source to fail on the next API call. Always update references before deleting.

To find all references before deleting:
```bash
CRED_ID="dnsfilter-api-key"

echo "=== Sources referencing $CRED_ID ==="
curl -s http://localhost:3847/api/sources/openapi | \
  jq -r --arg id "$CRED_ID" '.[] | select(.credentialId == $id) | .sourceId'

echo "=== Packages referencing $CRED_ID ==="
curl -s http://localhost:3847/api/packages | \
  jq -r --arg id "$CRED_ID" \
    '.[] | select(.credentialId == $id) | .id' 2>/dev/null || echo "(none)"
```

---

## 9. Audit credential access

Credential access is recorded in the audit log. To investigate credential-related events:

```bash
# List all audit events involving credentials
curl -s http://localhost:3847/api/audit | \
  jq '[.[] | select(.action | test("credential|call_tool"))]'

# Find events for a specific subject (user/service that called tools)
curl -s http://localhost:3847/api/audit | \
  jq '[.[] | select(.subjectId == "service-account-1")]'
```

For the audit search script, see `scripts/ops/audit-search.sh`.

---

## Quick reference

| Action | Method | Path |
|--------|--------|------|
| List credentials (redacted) | GET | `/api/credentials` |
| Create / upsert credential | POST | `/api/credentials` |
| Delete credential | DELETE | `/api/credentials/:credentialId` |

---

## Credential ID naming conventions

Suggested naming scheme for maintainability:

| Pattern | Example |
|---------|---------|
| `<service>-<type>` | `dnsfilter-api-key` |
| `<service>-<type>-v<N>` | `dnsfilter-api-key-v2` (during rotation) |
| `<env>-<service>-<type>` | `prod-quickbooks-oauth` |

---

## See also

- [openapi-source.md](./openapi-source.md) — binding credentials to OpenAPI sources
- [incident-response.md](./incident-response.md) — emergency credential revocation
- [operator-guide.md](../operator-guide.md) — day-to-day operations overview
