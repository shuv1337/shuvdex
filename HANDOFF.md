# HANDOFF

## Objective
Continue developing shuvdex — a centralized MCP capability gateway that proxies AI tool calls through a governed, policy-controlled server.

## Current status
- **MCP server**: running on shuvdev:3848, healthy, 5 capability packages indexed
- **API server**: running on shuvdev:3847, healthy
- **Governance dashboard**: served at `/dashboard` on both API and web
- **Security tests**: 52 tests, all passing (`npx vitest run tests/src/security`)
- **Certified capabilities**: echo, youtube-transcript, gitea-version, dnsfilter-current-user, crawl
- **Docs complete**: deployment guides, operations runbooks, onboarding playbooks, connector catalog, pilot framework (phases 3E–5E)
- **No tasks started** in `PLAN-debt-and-next-steps.md` — all checkboxes unchecked

## Key context
- Architecture: Turborepo monorepo, Effect-TS + Hono + MCP SDK + Zod v4
- Apps: `api`, `mcp-server`, `web`, `cli` (cli is dead code, removal planned)
- Dead packages exist: `git-ops`, `skill-ops`, `tool-registry` — plan phase 1 covers removal
- `CONTEXT.md` is missing/stale — plan phase 2 covers rewriting it
- Reporting endpoints live at `/api/reports/*` (usage, billing, governance, compliance-export)
- Dashboard endpoints at `/api/dashboard/*` (summary, audit-timeline, health-overview)
- `.factory/` directory has 100+ stale validation artifacts from retired fleet era

## Important files
- `PLAN-debt-and-next-steps.md` — active plan, 6 phases (debt cleanup → capability expansion)
- `AGENTS.md` — comprehensive project-level agent notes with restart procedures
- `scripts/run-mcp-certification.sh` — lightweight MCP certification harness
- `systemd/shuvdex-mcp.service` — versioned systemd unit
- `apps/api/src/routes/reporting.ts` — reporting endpoints
- `apps/api/public/dashboard.html` — governance dashboard (copy also at `apps/web/public/`)

## Next steps
1. **Start Phase 1** of the plan: dead code removal (`apps/cli`, `packages/git-ops`, `packages/skill-ops`, `packages/tool-registry`)
2. **Phase 2**: rewrite `CONTEXT.md`, archive completed plans, create `CHANGELOG.md`
3. **Phase 3**: add JSDoc comments to complex modules, telemetry annotations
4. **Phases 4–6**: new capability onboarding (upload, model-usage, ccusage), OpenAPI source expansion, web admin UI

## Risks / open questions
- `.factory/` — delete entirely or archive? Decision deferred to phase 1.2
- `CONTEXT.md` doesn't exist yet — agents may waste time without current-state docs
- No tasks in the plan have been validated; build/test should be run before any changes to confirm clean baseline
- Rebuild + restart required after any MCP server changes (see `AGENTS.md` for exact commands)
