# HANDOFF

## Objective
Continue developing shuvdex — a centralized MCP capability gateway that proxies AI tool calls through a governed, policy-controlled server.

## Current status
- **Phases 1–3 complete** — dead code removed, CONTEXT.md + CHANGELOG.md written, JSDoc added to server.ts and compiler.ts
- **Phase 4 complete** — 3 new capability packages: upload, model-usage, ccusage (all seeded and live)
- **Phase 6 complete** — 7 new admin UI pages (Dashboard, Packages, Policies, Credentials, Tokens, Sources, Audit)
- **E2E tests written** — 25 tests hitting the live MCP server, all passing
- **MCP server**: 8 packages indexed, running on shuvdev:3848
- **API server**: running on shuvdev:3847, DEV_MODE=true for local dev
- **Web UI**: running on shuvdev:5173, all 7 pages validated via shuvgeist
- **OpenCode config**: `~/.config/opencode/config.json` has shuvdex MCP server (clean config, only shuvdex)
- **opencode run** confirmed all tools callable end-to-end

## Key context
- Architecture: Turborepo monorepo, Effect-TS + Hono + MCP SDK + Zod v4
- Web UI had two bugs found during E2E: Credentials page crashed (API returns `schemeType` string, not `scheme` object), Audit page crashed (API returns structured objects, not flat fields). Both fixed with normalizer functions in `apps/web/src/api/client.ts`.
- `DEV_MODE=true` added to `systemd/shuvdex-api.service` — required for web UI to talk to API without auth tokens
- `model_usage.query` returns structured error on shuvdev (codexbar not installed) — this is expected behavior, not a bug
- Vite preview mode doesn't support SPA history fallback — direct URL navigation to sub-routes fails, but client-side nav works fine

## Important files
- `PLAN-debt-and-next-steps.md` — active plan (gitignored), phases 1–4+6 done, 5+7 remaining
- `CONTEXT.md` — current-state architecture reference for agents
- `tests/src/e2e/mcp-server.test.ts` — 25 E2E tests against live MCP server
- `apps/web/src/api/client.ts` — API client with normalizers for audit/credential shape mismatches
- `systemd/shuvdex-api.service` — includes DEV_MODE=true
- `examples/{upload,model-usage,ccusage}-skill/` — phase 4 capability packages
- `scripts/seed-{upload,model-usage,ccusage}.mjs` — seed scripts for new capabilities

## Next steps
1. **Phase 5** — Add more OpenAPI capability sources (Cloudflare, Make.com, Datto, internal APIs)
2. **Phase 7** — Parking lot items: builtin executor, mcp_proxy executor, capability change notifications, multi-tenant isolation
3. **Vite SPA fallback** — Consider adding historyApiFallback to vite preview config or switching to nginx for static serving
4. **Install codexbar on shuvdev** — Would make model_usage.query functional instead of returning "command not found"

## Risks / open questions
- Web UI runs in Vite preview mode — no SPA history fallback means bookmarking sub-routes or refreshing on them shows blank page
- `DEV_MODE=true` on API bypasses all auth — fine for dev, needs to be removed before any real multi-tenant deployment
- Pre-existing test failures in skill-indexer (stale fixture refs to renamed `browser` skill) and skill-importer (Node 25.x compat) are unrelated to current work
