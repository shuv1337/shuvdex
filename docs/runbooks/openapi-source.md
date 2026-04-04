# Runbook: OpenAPI Source Management

An OpenAPI source connects shuvdex to an external API by pointing it at an OpenAPI spec URL. shuvdex fetches the spec, compiles it into capability definitions, and stores the resulting package in the capability registry. From that point the API's operations are surfaced as tools through the MCP server.

**Base URL:** `http://localhost:3847` (override with `SHUVDEX_API_URL`)
**Auth header:** `Authorization: Bearer <token>` (required when auth is enabled)

---

## Contents

1. [List all registered sources](#1-list-all-registered-sources)
2. [Inspect a spec before registering](#2-inspect-a-spec-before-registering)
3. [Register an OpenAPI source (no credential)](#3-register-an-openapi-source-no-credential)
4. [Register an OpenAPI source with an API key credential](#4-register-an-openapi-source-with-an-api-key-credential)
5. [Sync (refresh) a source](#5-sync-refresh-a-source)
6. [Test auth for a registered source](#6-test-auth-for-a-registered-source)
7. [Handle sync failures](#7-handle-sync-failures)
8. [Update a source URL or description](#8-update-a-source-url-or-description)
9. [Rotate the credential on a source](#9-rotate-the-credential-on-a-source)
10. [Remove a source](#10-remove-a-source)

---

## 1. List all registered sources

```bash
curl -s http://localhost:3847/api/sources/openapi | jq .
```

**Response fields:**
- `sourceId` — unique identifier for this source
- `specUrl` — the OpenAPI spec URL
- `selectedServerUrl` — the base URL used for actual API calls
- `credentialId` — credential bound to this source (if any)
- `packageId` — the capability package generated from this source
- `companionPackageId` — associated companion package (if any)
- `tags` — operator-assigned tags
- `lastSyncedAt` — when the source was last compiled

---

## 2. Inspect a spec before registering

Use the inspect endpoint to preview what capabilities would be generated from a spec without committing:

```bash
curl -s -X POST http://localhost:3847/api/sources/openapi/inspect \
  -H "Content-Type: application/json" \
  -d '{
    "specUrl": "https://api.example.com/openapi.json",
    "title": "Example API",
    "selectedServerUrl": "https://api.example.com"
  }' | jq .
```

With credential and operation filter:
```bash
curl -s -X POST http://localhost:3847/api/sources/openapi/inspect \
  -H "Content-Type: application/json" \
  -d '{
    "specUrl": "https://api.example.com/openapi.json",
    "title": "Example API",
    "selectedServerUrl": "https://api.example.com",
    "credentialId": "example-api-key",
    "operationFilter": {
      "allowedOperationIds": ["getUser", "listUsers"]
    }
  }' | jq .
```

**Inspect response includes:**
- `capabilities` — list of tools that would be generated
- `warnings` — spec issues or unsupported patterns
- `packageId` — the ID that would be assigned

---

## 3. Register an OpenAPI source (no credential)

For public APIs or internal APIs on the same network:

```bash
curl -s -X POST http://localhost:3847/api/sources/openapi \
  -H "Content-Type: application/json" \
  -d '{
    "sourceId": "gitea-api",
    "specUrl": "http://gitea.internal:3000/swagger.v1.json",
    "title": "Gitea",
    "description": "Internal Gitea instance",
    "selectedServerUrl": "http://gitea.internal:3000",
    "tags": ["internal", "git"],
    "defaultRiskLevel": "low"
  }' | jq .
```

**Required fields:**
- `specUrl` — URL to the OpenAPI JSON or YAML spec
- `title` — human-readable name
- `selectedServerUrl` — base URL for API calls

**Optional fields:**
- `sourceId` — stable ID (auto-generated if omitted)
- `description`
- `tags`
- `credentialId` — reference to a credential in the store
- `operationFilter` — restrict which operations are compiled
- `defaultTimeoutMs` — per-call timeout (default: 30000)
- `defaultRiskLevel` — `low`, `medium`, or `high` (default: `medium`)
- `packageIdOverride` — force a specific package ID
- `companionPackageId` — attach a companion package

---

## 4. Register an OpenAPI source with an API key credential

**Step 1:** Create the credential (see [credential-management.md](./credential-management.md)):

```bash
curl -s -X POST http://localhost:3847/api/credentials \
  -H "Content-Type: application/json" \
  -d '{
    "credentialId": "dnsfilter-api-key",
    "description": "DNSFilter API key",
    "scheme": {
      "type": "api_key",
      "in": "header",
      "name": "Authorization",
      "value": "Token YOUR_API_KEY_HERE"
    }
  }' | jq .
```

**Step 2:** Register the source referencing the credential:

```bash
curl -s -X POST http://localhost:3847/api/sources/openapi \
  -H "Content-Type: application/json" \
  -d '{
    "sourceId": "dnsfilter-api",
    "specUrl": "https://api.dnsfilter.com/v2/swagger/doc.json",
    "title": "DNSFilter API",
    "description": "DNSFilter management API",
    "selectedServerUrl": "https://api.dnsfilter.com",
    "credentialId": "dnsfilter-api-key",
    "tags": ["dns", "security", "network"],
    "defaultRiskLevel": "medium"
  }' | jq .
```

**Step 3:** Test authentication:

```bash
curl -s -X POST http://localhost:3847/api/sources/openapi/dnsfilter-api/test-auth | jq .
```

---

## 5. Sync (refresh) a source

Re-fetch the spec and recompile capabilities. Use this after the upstream API adds new operations or changes schemas:

```bash
curl -s -X POST http://localhost:3847/api/sources/openapi/dnsfilter-api/refresh | jq .
```

**Response:** updated list of capabilities compiled from the refreshed spec.

To sync all sources at once:
```bash
curl -s http://localhost:3847/api/sources/openapi | \
  jq -r '.[].sourceId' | \
  while read -r source_id; do
    echo "Refreshing $source_id..."
    curl -s -X POST "http://localhost:3847/api/sources/openapi/${source_id}/refresh" | \
      jq '{sourceId: .sourceId, capCount: (.capabilities | length)}'
  done
```

---

## 6. Test auth for a registered source

Verify the credential is configured correctly without running a full refresh:

```bash
curl -s -X POST http://localhost:3847/api/sources/openapi/dnsfilter-api/test-auth | jq .
```

A successful response returns HTTP 200 with auth test details. A failure returns an error with the HTTP status received from the upstream API.

---

## 7. Handle sync failures

**Symptom:** `POST /:sourceId/refresh` returns an error or empty capabilities.

**Diagnostic steps:**

1. Check the spec URL is reachable:
   ```bash
   curl -sv "https://api.example.com/openapi.json" | head -20
   ```

2. Test auth separately:
   ```bash
   curl -s -X POST http://localhost:3847/api/sources/openapi/my-source/test-auth | jq .
   ```

3. Inspect the spec without saving:
   ```bash
   curl -s -X POST http://localhost:3847/api/sources/openapi/inspect \
     -H "Content-Type: application/json" \
     -d '{
       "specUrl": "https://api.example.com/openapi.json",
       "title": "Test",
       "selectedServerUrl": "https://api.example.com"
     }' | jq .warnings
   ```

4. Check the source's current state:
   ```bash
   curl -s http://localhost:3847/api/sources/openapi/my-source | jq .
   ```

**Common causes:**
- Spec URL is behind auth (add credential and update source)
- Spec has non-standard format or version (v1 Swagger may have limited support)
- Network unreachable from the shuvdex host
- `selectedServerUrl` doesn't match what the spec declares

---

## 8. Update a source URL or description

Use `PATCH` to update specific fields without replacing the entire source:

```bash
# Update the spec URL
curl -s -X PATCH http://localhost:3847/api/sources/openapi/gitea-api \
  -H "Content-Type: application/json" \
  -d '{
    "specUrl": "http://gitea.internal:3000/swagger.v2.json"
  }' | jq .

# Update description and tags
curl -s -X PATCH http://localhost:3847/api/sources/openapi/gitea-api \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Internal Gitea (migrated to v2 API)",
    "tags": ["internal", "git", "v2"]
  }' | jq .

# After updating the URL, refresh to pull the new spec
curl -s -X POST http://localhost:3847/api/sources/openapi/gitea-api/refresh | jq .
```

---

## 9. Rotate the credential on a source

When a credential is rotated, update the source binding:

```bash
# Update source to reference the new credential
curl -s -X PATCH http://localhost:3847/api/sources/openapi/dnsfilter-api \
  -H "Content-Type: application/json" \
  -d '{
    "credentialId": "dnsfilter-api-key-v2"
  }' | jq .

# Verify auth still works
curl -s -X POST http://localhost:3847/api/sources/openapi/dnsfilter-api/test-auth | jq .
```

For the full credential rotation workflow, see [credential-management.md](./credential-management.md).

---

## 10. Remove a source

Deleting a source also removes the generated capability package from the registry:

```bash
curl -s -X DELETE http://localhost:3847/api/sources/openapi/dnsfilter-api | jq .
```

> **Note:** Capabilities from the deleted source are immediately removed from the MCP tool list. Active AI sessions that cached the tool list may still see it until they call `tools/list` again.

---

## Quick reference

| Action | Method | Path |
|--------|--------|------|
| List sources | GET | `/api/sources/openapi` |
| Inspect spec (no save) | POST | `/api/sources/openapi/inspect` |
| Register source | POST | `/api/sources/openapi` |
| Get source | GET | `/api/sources/openapi/:sourceId` |
| Update source | PATCH | `/api/sources/openapi/:sourceId` |
| Refresh source | POST | `/api/sources/openapi/:sourceId/refresh` |
| Test auth | POST | `/api/sources/openapi/:sourceId/test-auth` |
| Delete source | DELETE | `/api/sources/openapi/:sourceId` |

---

## See also

- [credential-management.md](./credential-management.md) — creating and rotating credentials
- [package-lifecycle.md](./package-lifecycle.md) — managing the packages that sources generate
- [operator-guide.md](../operator-guide.md) — day-to-day operations overview
