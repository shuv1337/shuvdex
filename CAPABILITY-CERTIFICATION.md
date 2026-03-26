# Capability Certification Ledger

This ledger records externally meaningful capability certification status for `shuvdex`.

Status model used here:
- `planned`
- `import-passing`
- `mcp-passing`
- `live-passing`
- `e2e-passing`
- `blocked`
- `needs-conversion`
- `skipped`

## Live running instance snapshot

Validated against the currently running services on `shuvdev`:
- API: `http://127.0.0.1:3847`
- MCP: `http://127.0.0.1:3848/mcp`

Current live package set in the running instance:
- `skill.module_runtime_template`
- `skill.youtube_transcript`
- `openapi.gitea.api`
- `openapi.dnsfilter.api`
- `skill.crawl`

Current MCP-visible tools from the live instance:
- `openapi.dnsfilter.api.currentUser`
- `openapi.gitea.api.getVersion`
- `skill.crawl.start`
- `skill.crawl.status`
- `skill.module_runtime_template.echo`
- `skill.youtube_transcript.fetch_transcript`

## Certified and in-progress capabilities

| Capability | Package ID | Client-visible tool name | Executor | Readiness | Import | MCP | Live | Lightweight MCP E2E | Host(s) | Last validated | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Deterministic echo fixture | `skill.module_runtime_template` | `skill.module_runtime_template.echo` | `module_runtime` | ready-now | ✅ | ✅ | ✅ | ✅ | `shuvdev` | 2026-03-25 | Live MCP smoke call passed with `LIVE_SMOKE_OK`. This is now validated through the lightweight direct-MCP certification flow rather than an external AI client requirement. |
| YouTube transcript | `skill.youtube_transcript` | `skill.youtube_transcript.fetch_transcript` | `module_runtime` | ready-now | ✅ | ✅ | ✅ | ✅ | `shuvdev` | 2026-03-25 | Present in the live instance and direct MCP smoke call returned transcript for `dQw4w9WgXcQ` with `entryCount=61`. |
| Gitea version | `openapi.gitea.api` | `openapi.gitea.api.getVersion` | `http_api` | ready-now | ✅ compile | ✅ | ✅ | ✅ | `shuvdev` | 2026-03-25 | Present in the live instance and direct MCP smoke call returned real version `1.26.0+dev-489-gc9a038bc4e`. |
| DNSFilter current user | `openapi.dnsfilter.api` | `openapi.dnsfilter.api.currentUser` | `http_api` | ready-now | ✅ compile | ✅ | ✅ | ✅ | `shuvdev` | 2026-03-25 | Present in the live instance and direct MCP smoke call returned authenticated current-user data including `kyle@latitudes.io`. |
| Crawl | `skill.crawl` | `skill.crawl.start`, `skill.crawl.status` | `module_runtime` | ready-now | ✅ | ✅ | ✅ | ✅ | `shuvdev` | 2026-03-25 | Full live MCP flow proven against `https://example.com`: `start` returned job `8e4f879c-b20e-4072-aedc-f85cf091d03b`, `status` reported `completed`, and `wait` returned extracted markdown for Example Domain. |
| Upload | TBD | TBD | TBD | needs-conversion | ☐ | ☐ | ☐ | ☐ | — | — | High-value artifact-producing target; currently script-oriented rather than fully manifest-backed. |
| Model usage | TBD | TBD | TBD | needs-conversion | ☐ | ☐ | ☐ | ☐ | — | — | Likely requires manifest/runtime wrapper around current script flow. |
| ccusage | TBD | TBD | TBD | needs-conversion | ☐ | ☐ | ☐ | ☐ | — | — | Multi-host and artifact-heavy; likely certify summary mode first. |

## Latest live smoke results

These were run directly against the currently running MCP endpoint on 2026-03-25.

- `openapi.gitea.api.getVersion`
  - result: `version = 1.26.0+dev-489-gc9a038bc4e`
- `openapi.dnsfilter.api.currentUser`
  - result: authenticated user email `kyle@latitudes.io`
- `skill.youtube_transcript.fetch_transcript`
  - result: `videoId = dQw4w9WgXcQ`, `entryCount = 61`
- `skill.module_runtime_template.echo`
  - result: echoed `LIVE_SMOKE_OK`
- `skill.crawl.status`
  - result: `action=list-jobs` returned recent crawl-job history

## Latest crawl live certification

A real crawl was executed against a safe public target through the live MCP endpoint.

Target:
- `https://example.com`

Start call:
- tool: `skill.crawl.start`
- arguments:
  - `action = start`
  - `url = https://example.com`
  - `limit = 3`
  - `format = markdown`
  - `noRender = true`
- result:
  - `jobId = 8e4f879c-b20e-4072-aedc-f85cf091d03b`

Status polling:
- tool: `skill.crawl.status`
- arguments:
  - `action = status`
  - `jobId = 8e4f879c-b20e-4072-aedc-f85cf091d03b`
- observed state:
  - `Status: completed`
  - `Progress: 1 / 1 pages`

Wait/result retrieval:
- tool: `skill.crawl.status`
- arguments:
  - `action = wait`
  - `jobId = 8e4f879c-b20e-4072-aedc-f85cf091d03b`
- returned extracted content including:
  - `# Example Domain`
  - `This domain is for use in documentation examples without needing permission.`

Certification outcome:
- `skill.crawl` now counts as live-passing and lightweight-MCP-E2E-passing on `shuvdev`

## Artifact roots

Lightweight certification artifacts:
- `/tmp/shuvdex-mcp-certification/echo/`
- `/tmp/shuvdex-mcp-certification/youtube-transcript/`
- `/tmp/shuvdex-mcp-certification/gitea-version/`
- `/tmp/shuvdex-mcp-certification/dnsfilter-current-user/`
- `/tmp/shuvdex-mcp-certification/crawl/`

Important files per target:
- `summary.json`
- `health.json`
- `initialize.json`
- `tools-list.json`
- `tool-call.json`
- `tool-call-negative.json` when applicable
- `crawl-start.json`, `crawl-status.json`, `crawl-wait.json` for crawl

## Notes

- The primary certification path no longer depends on OpenCode or Codex.
- Preferred tooling is now:
  - `curl`
  - `jq`
  - direct HTTP MCP requests
- The historical script name remains:
  - `scripts/run-mcp-certification.sh`
- During this session, the move away from heavyweight external AI clients was intentional so certification is cheaper, less flaky, and easier to repeat.

## Next certification priorities

1. One artifact-producing capability (`upload` likely first)
2. Conversion-first work for `model-usage` and `ccusage`
3. Optional client-specific smoke checks only if they provide value beyond direct MCP certification
