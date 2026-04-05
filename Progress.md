# Progress

## Status
Completed

## Tasks
- [x] Study existing OpenAPI seed scripts (gitea, dnsfilter)
- [x] Locate Hetzner Cloud OpenAPI spec URL: `https://docs.hetzner.cloud/cloud.spec.json`
- [x] Create `scripts/seed-hetzner-openapi.mjs` following DNSFilter pattern
- [x] Seed the capability (43 capabilities created)
- [x] Rebuild and restart MCP server (package count: 8 → 9)
- [x] Verify Hetzner tools are available (43 tools confirmed)
- [x] Add certification target for Hetzner in `run-mcp-certification.sh`
- [x] Verify total tool count: 52 tools (added 43 Hetzner tools)

## Files Changed
- `scripts/seed-hetzner-openapi.mjs` - New seed script for Hetzner Cloud API
- `scripts/run-mcp-certification.sh` - Add `hetzner` target with `openapi.hetzner.api.list.servers`
- `.capabilities/packages/openapi.hetzner.api.yaml` - Generated capability package (43 tools)
- `.capabilities/credentials/hetzner-api-token.json.enc` - Generated credential (placeholder)
- `.capabilities/sources/openapi/openapi.hetzner.api.source.json` - Source record

## New Hetzner Cloud API Capabilities (43 tools)
- Servers: list, get, actions, metrics
- SSH Keys: list, get
- Images: list, get, actions
- Locations: list, get
- Datacenters: list, get
- Floating IPs: list, get, actions
- Volumes: list, get, actions
- Networks: list, get, actions
- Firewalls: list, get, actions

## Certification Status
- Certification script updated with `hetzner` target
- Tool name: `openapi.hetzner.api.list.servers`
- Handler validates response contains `.servers` array
- **Note:** Certification requires real HETZNER_API_TOKEN - currently using placeholder

## How to Configure Real Token
1. Get token from Hetzner Console: Security → API Tokens
2. Set environment variable: `export HETZNER_API_TOKEN=your_token`
3. Or add to `~/.config/shiv/secrets.json`: `{ "hetzner": { "apiToken": "your_token" } }`
4. Re-run seed script: `node scripts/seed-hetzner-openapi.mjs`
5. Restart MCP server: `systemctl --user restart shuvdex-mcp.service`
6. Run certification: `TARGET=hetzner ./scripts/run-mcp-certification.sh`
