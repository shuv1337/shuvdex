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

## Certified and in-progress capabilities

| Capability | Package ID | Client-visible tool name | Executor | Readiness | Import | MCP | Live | External E2E | Host(s) | Last validated | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Deterministic echo fixture | `skill.module_runtime_template` | `shuvdex_skill_module_runtime_template_echo` | `module_runtime` | ready-now | ✅ | ✅ | ✅ | ✅ | `shuvdev` | 2026-03-23 | Clean-room OpenCode external proof via `scripts/run-remote-mcp-e2e.sh` target `echo`. |
| YouTube transcript | `skill.youtube_transcript` | `shuvdex_skill_youtube_transcript_fetch_transcript` | `module_runtime` | ready-now | ✅ | ✅ | ✅ | ✅ | `shuvdev` | 2026-03-23 | External OpenCode run fetched real transcript for `dQw4w9WgXcQ`. Internal automated execution already passing. |
| Gitea version | `openapi.gitea.api` | `shuvdex_openapi_gitea_api_getVersion` | `http_api` | ready-now | ✅ compile | ✅ | ✅ | ✅ | `shuvdev` | 2026-03-23 | External OpenCode run returned real version from `https://gitea.com/api/v1/version`. |
| Crawl | `skill.crawl` | TBD | `module_runtime` | ready-now | ☐ | ☐ | ☐ | ☐ | — | — | Likely next module-runtime real-world certification target. Will require Cloudflare credentials and safe crawl target. |
| DNSFilter current user | `openapi.dnsfilter.api` | `shuvdex_openapi_dnsfilter_api_currentUser` | `http_api` | ready-now | ✅ compile | ✅ | ✅ | ✅ | `shuvdev` | 2026-03-23 | External OpenCode run returned real authenticated DNSFilter current-user data from `GET /v1/current_user` using `Authorization: <DNSFILTER_API_KEY>`. |
| Upload | TBD | TBD | TBD | needs-conversion | ☐ | ☐ | ☐ | ☐ | — | — | High-value artifact-producing target; currently script-oriented rather than fully manifest-backed. |
| Model usage | TBD | TBD | TBD | needs-conversion | ☐ | ☐ | ☐ | ☐ | — | — | Likely requires manifest/runtime wrapper around current script flow. |
| ccusage | TBD | TBD | TBD | needs-conversion | ☐ | ☐ | ☐ | ☐ | — | — | Multi-host and artifact-heavy; likely certify summary mode first. |

## Artifact roots from latest external runs

OpenCode clean-room artifacts:
- `/tmp/shuvdex-opencode-clean/artifacts/echo/`
- `/tmp/shuvdex-opencode-clean/artifacts/youtube-transcript/`
- `/tmp/shuvdex-opencode-clean/artifacts/gitea-version/`
- `/tmp/shuvdex-opencode-clean/artifacts/dnsfilter-current-user/`

Important files per target:
- `summary.json`
- `mcp-list.txt`
- `tool-discovery.jsonl`
- `tool-call.jsonl`
- `health.json`

## Notes

- External client currently validated: `OpenCode`
- Current provider/model default:
  - `provider: opencode`
  - `model: opencode/gpt-5-nano`
- External runs are now parameterized via:
  - `scripts/run-remote-mcp-e2e.sh`
- Supported current targets:
  - `echo`
  - `youtube-transcript`
  - `gitea-version`
  - `dnsfilter-current-user`

## Next certification priorities

1. `crawl`
2. DNSFilter current user authenticated certification
3. one artifact-producing capability (`upload` likely first)
