# Code Context: shuvdex (shuvdex → shuvdex Rename Project)

## Executive Summary

**Current State:** This is a Node.js/TypeScript monorepo project currently named `shuvdex` that is in the process of being renamed to `shuvdex`. The local directory has already been renamed to `/home/shuv/repos/shuvdex`, but all source code, packages, and configuration still reference the old `shuvdex` name. **No references to Pokédex or "pokedex" exist in this codebase.**

**What This Project Is:** A centralized capability gateway system (MCP server + REST API + React UI) that manages skill discovery, policy enforcement, and tool execution across a distributed system.

---

## Files Retrieved

### Core Configuration Files
1. `package.json` (root) - Monorepo root, currently named `"shuvdex"`, pinned to npm 11.7.0
2. `tsconfig.json` + `tsconfig.base.json` - ES2022 target, strict mode, composite project references
3. `turbo.json` - Monorepo task orchestration (build, test, typecheck, lint, clean)
4. `vitest.config.ts` - Minimal config, globals disabled, passWithNoTests true
5. `README.md` - Full project documentation (currently describes `shuvdex`)
6. `opencode.jsonc` - OpenCode IDE config with MCP server definition (broken paths to `/home/shuv/repos/shuvdex`)

### Key Planning / Documentation
7. `PLAN-rename-to-shuvdex.md` (600+ lines) - **Comprehensive rename plan** documenting:
   - 162+ hits across 64 tracked files
   - Phase-by-phase execution plan with 11 phases + risk analysis
   - Bulk replacement guidance and sequencing
   - Currently at Phase 8.3 (directory rename is done; source code rename is pending)

### Source Code Structure

#### Apps (3 active)
- `apps/mcp-server/` - MCP protocol gateway server
  - `src/server.ts` - **Critical**: Contains hardcoded `name: "shuvdex"` (the MCP server identity)
  - `src/index.ts` - Entry point with JSDoc `@shuvdex/mcp-server`
  - Tests: `test/codex-integration.test.ts`, `test/protocol.test.ts`, `test/stdio.test.ts`
  
- `apps/api/` - HTTP REST API (Hono + Node.js)
  - `src/index.ts` - Hono app with JSDoc `@shuvdex/api`
  - Routes: audit, hosts, packages, policies, skills, tokens, tools
  - `src/routes/packages.ts` - Temp dir prefix `shuvdex-upload-`
  
- `apps/web/` - React/Vite frontend
  - `index.html` - `<title>shuvdex</title>`
  - `src/components/Layout.tsx` - UI label `shuvdex`
  - `src/api/client.ts` - Comment `shuvdex REST API`

- `apps/cli/` - (Present but no package.json; future/placeholder)

#### Packages (11 total)
- `packages/capability-registry/` - Capability package model + storage (temp prefix: `shuvdex-capabilities-`)
- `packages/core/` - Host config types + loading (temp prefix: `shuvdex-test-`)
- `packages/execution-providers/` - Executor abstraction
- `packages/policy-engine/` - **Critical**: Token issuance, ACLs, audit
  - `src/live.ts` - `DEFAULT_ISSUER = "shuvdex"`, dev secret `shuvdex-dev-secret`, temp prefix `shuvdex-policy-`
  - (⚠️ Changing issuer + secret will invalidate existing dev tokens)
- `packages/skill-importer/` - Skill import/upload (temp prefix: `shuvdex-upload-`)
- `packages/skill-indexer/` - Compiles SKILL.md into capability packages
- `packages/ssh/` - SSH execution layer (imports JSDoc `@shuvdex/telemetry`)
- `packages/telemetry/` - **Critical**: OTEL tracing
  - `src/live.ts` - `serviceName: "shuvdex"` (appears twice in different layers)
  - (⚠️ Changing service name creates new identity in OTEL/Maple; old telemetry orphaned)
- `packages/git-ops/` - (No package.json; support/utility code)
- `packages/skill-ops/` - (No package.json; support/utility code)
- `packages/tool-registry/` - (No package.json; support/utility code)

### Factory / Validation Artifacts
- `.factory/` - Contains 70+ tracked files with old references:
  - `.factory/init.sh` - Absolute paths to `/home/shuv/repos/shuvdex`
  - `.factory/library/user-testing.md` - 13+ references (package names, paths, prefixes)
  - `.factory/skills/*/SKILL.md` (3 files) - Worker skill docs
  - `.factory/validation/` - 65 files (JSON, synthesis, scrutiny reviews, support configs)
    - All contain `/home/shuv/repos/shuvdex` absolute paths (now broken)
    - All contain `@shuvdex/*` package references

### Historical / Generated Artifacts
- `dogfood-output/shuvdex-2026-03-17/` - Timestamp-named folder with `report.md`
- `.pi/suggester/seed.json` - Generated metadata (not yet updated)

### Documentation / Plans
- `PLAN.md` - General project plan (14+ `shuvdex` references)
- `PLAN-skills-package-import.md` - Skills import plan (multiple references)
- `TEST-MATRIX-shuvbot-skills.md` - Test matrix (multiple references)

---

## Project Naming Convention Reference

**Current → Target Mappings:**

| Pattern | Old | New | Count | Examples |
|---------|-----|-----|-------|----------|
| Package scope | `@shuvdex/*` | `@shuvdex/*` | ~50 | `@shuvdex/api`, `@shuvdex/mcp-server` |
| Hyphenated | `shuvdex` | `shuvdex` | ~100+ | Root package name, MCP server identity, UI labels |
| Snake case | `shuvdex` | `shuvdex` | 5 | TOML sections `[mcp_servers.shuvdex]` |
| Pascal case | `Shuvdex` | `Shuvdex` | 4 | Function `parseShuvdexConfig` + 3 call sites |
| Temp prefixes | `shuvdex-*` | `shuvdex-*` | ~10 | `-upload-`, `-mcp-`, `-test-`, `-policy-`, `-capabilities-` |
| Absolute paths | `/home/shuv/repos/shuvdex` | `/home/shuv/repos/shuvdex` | 54 | Config, factory validation files (currently broken) |

---

## Architecture Overview

```
shuvdex (Capability Gateway System)
│
├── MCP Layer (apps/mcp-server)
│   └── Exposes tools, resources, prompts over MCP protocol
│       Delegates execution to ExecutionProvidersService
│
├── REST API Layer (apps/api)
│   └── HTTP routes for capability management, policy admin, host mgmt
│       ├── CapabilityRegistry (CRUD for packages)
│       ├── PolicyEngine (tokens, ACLs, audit)
│       ├── SkillImporter (skill upload/sync)
│       └── SkillIndexer (compile SKILL.md → capabilities)
│
├── UI Layer (apps/web)
│   └── React/Vite frontend for capability visualization
│
└── Core Services (packages/)
    ├── Policy Engine → Token issuance, authorization, audit log
    ├── Telemetry → OTEL/Maple tracing
    ├── Execution Providers → Tool execution dispatch
    ├── Skill Indexer → SKILL.md compiler
    └── SSH Runner → Distributed execution layer
```

**Data Flow:**
1. Skills are indexed from `SKILL.md` + optional `capability.yaml`
2. Compiled into capability packages (stored in `.capabilities/packages/`)
3. MCP server loads packages, applies policies
4. REST API manages packages, issues tokens, logs audit events
5. Telemetry streams to Maple Ingest (OTEL/HTTP)

---

## Key Code Sections

### MCP Server Identity (CRITICAL)
**File:** `apps/mcp-server/src/server.ts` (line ~180)
```typescript
export function createServer(config?: ServerConfig): McpServer {
  const server = new McpServer(
    {
      name: "shuvdex",  // ← MUST CHANGE TO "shuvdex"
      version: "0.0.0",
      ...
```

### Policy Engine Issuer (CRITICAL - SECURITY)
**File:** `packages/policy-engine/src/live.ts` (line ~21)
```typescript
const DEFAULT_ISSUER = "shuvdex";  // ← MUST CHANGE (invalidates tokens)
const DEFAULT_KEY_ID = "local-hs256";
```

Further down:
```typescript
// Likely contains dev secret:
"shuvdex-dev-secret"  // ← MUST CHANGE
```

### Telemetry Service Identity (CRITICAL - OBSERVABILITY)
**File:** `packages/telemetry/src/live.ts` (line ~27)
```typescript
serviceName: "shuvdex",  // ← MUST CHANGE (creates new service in OTEL)
```

And in `OtlpTracingLive()`:
```typescript
serviceName: "shuvdex",  // ← APPEARS AGAIN
```

### OpenCode Config (BROKEN PATHS)
**File:** `opencode.jsonc`
```jsonc
"shuvdex": {
  "type": "local",
  "command": ["node", "apps/mcp-server/dist/index.js"],
  "enabled": true,
  "environment": {
    "CAPABILITIES_DIR": "/home/shuv/repos/shuvdex/.run/...",  // ← BROKEN
    "POLICY_DIR": "/home/shuv/repos/shuvdex/.run/..."  // ← BROKEN
  }
}
```

---

## Old Name References Summary

### By Count
- **Total affected files:** 65 unique files (excluding plan itself)
- **Total references:** 162+ across tracked source, docs, config, tests, validation

### By Category

**Package Manifests (12 files):**
- Root `package.json`
- `apps/api/package.json`, `apps/mcp-server/package.json`, `apps/web/package.json`
- `packages/capability-registry/package.json`, `packages/core/package.json`, `packages/execution-providers/package.json`, `packages/policy-engine/package.json`, `packages/skill-importer/package.json`, `packages/skill-indexer/package.json`, `packages/ssh/package.json`, `packages/telemetry/package.json`

**Source Files (28 files):**
- App entry points and routes (apps/*/src/*)
- Package source and tests (packages/*/src/*, packages/*/test/*)

**Config / Documentation (7 files):**
- `README.md`, `opencode.jsonc`, `.codex/config.toml`
- Plan files: `PLAN.md`, `PLAN-skills-package-import.md`, `TEST-MATRIX-shuvbot-skills.md`

**Factory / Validation (18 files):**
- `.factory/init.sh`, `.factory/library/user-testing.md`
- 3 worker skill docs
- 12+ `.factory/validation/` files

---

## Start Here

**Phase 1: Pre-flight**
1. Review `PLAN-rename-to-shuvdex.md` fully (lines 1–100) for scope + risk notes
2. Create git tag: `git tag pre-rename HEAD`
3. Verify working tree is clean: `git status`

**Phase 2A: Identity (CRITICAL)**
Do these **first** because they affect runtime behavior and security:
1. Update `packages/policy-engine/src/live.ts`:
   - `DEFAULT_ISSUER = "shuvdex"` → `"shuvdex"`
   - Dev secret `"shuvdex-dev-secret"` → `"shuvdex-dev-secret"`
   - Temp prefix `"shuvdex-policy-"` → `"shuvdex-policy-"`

2. Update `packages/telemetry/src/live.ts`:
   - Both `serviceName: "shuvdex"` → `"shuvdex"`

3. Update `apps/mcp-server/src/server.ts`:
   - MCP server `name: "shuvdex"` → `"shuvdex"` (line ~180)

**Phase 2B: Package Names**
1. Bulk replace all `package.json` files: `@shuvdex/*` → `@shuvdex/*`
2. Bulk replace all imports across source: `@shuvdex/` → `@shuvdex/`

**Phase 3: Strings & Paths**
1. Replace `shuvdex` → `shuvdex` (catches general hyphenated form)
2. Replace `/home/shuv/repos/shuvdex` → `/home/shuv/repos/shuvdex` (fixes 54 broken absolute paths)
3. Replace `shuvdex` → `shuvdex` (TOML sections, identifiers)
4. Replace `Shuvdex` → `Shuvdex` (function name + call sites in one test)

**Phase 4: Temp Prefixes & Config**
- Replace all `shuvdex-` prefixes with `shuvdex-`
- Update `opencode.jsonc` MCP key and paths
- Update `.codex/config.toml` if present
- Rename `apps/mcp-server/test/codex-integration.test.ts` → `codex-mcp-server/test/shuvdex-integration.test.ts` (use `git mv`)

**Phase 5: Factory Artifacts**
- Bulk update 65 `.factory/validation/` files
- Update `.factory/init.sh` and `.factory/library/user-testing.md`
- Update 3 `.factory/skills/*.md` files

**Phase 6: Final Validation**
1. `npm install`
2. `npm run clean && npm run build`
3. `npm test`
4. Verify MCP server identity:
   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}' \
     | node apps/mcp-server/dist/index.js 2>/dev/null \
     | jq -r '.result.serverInfo.name'
   # Expected: shuvdex
   ```

5. Final grep to verify zero old references:
   ```bash
   rg -n "shuvdex|shuvdex|Shuvdex|CODEX_FLEET|@shuvdex/" \
     -g '!node_modules' -g '!dist' -g '!.run' -g '!*.tsbuildinfo' -g '!package-lock.json' -g '!PLAN-rename-to-shuvdex.md'
   # Expected: no output
   ```

---

## Risk & Continuity Notes

1. **Telemetry Continuity:** Changing `serviceName` from `shuvdex` to `shuvdex` creates a **new service identity in OTEL/Maple**. Historical telemetry remains under the old name; there will be a discontinuity line in dashboards.

2. **Policy Token Invalidation:** Changing `DEFAULT_ISSUER` and the dev secret will **invalidate any previously issued dev tokens**. This is expected for a rename but worth noting if tokens are being used elsewhere.

3. **Broken Absolute Paths (Current):** The local directory was renamed but **54 tracked files still reference `/home/shuv/repos/shuvdex`**. These are non-functional but not blocking (no tests exercise these paths at runtime). They will be fixed by the bulk replacement in Phase 3.

4. **Ephemeral `.run/` Paths:** `opencode.jsonc` references a dated `.run/ui-demo-20260321-001506/` directory that doesn't match any stable config structure. Recommend normalizing to stable `.capabilities/*` paths or dropping the `environment` block entirely.

5. **No Pokédex Relationship:** This project has no connection to Pokédex; "shuvdex" is a personal project name (likely "Shuv" + "dex" = "Shuvdex").

---

## Implementation Checklist

- [ ] Review `PLAN-rename-to-shuvdex.md` fully
- [ ] Create git tag `pre-rename`
- [ ] Update identity files (policy engine, telemetry, MCP server)
- [ ] Bulk replace `@shuvdex/*` → `@shuvdex/*` in all files
- [ ] Bulk replace `shuvdex` → `shuvdex`
- [ ] Bulk replace `/home/shuv/repos/shuvdex` → `/home/shuv/repos/shuvdex`
- [ ] Bulk replace `shuvdex` → `shuvdex`
- [ ] Bulk replace `Shuvdex` → `Shuvdex`
- [ ] Replace all temp prefixes
- [ ] Update config files (opencode.jsonc, .codex/config.toml)
- [ ] Rename test file with `git mv`
- [ ] Update factory artifacts (init.sh, user-testing.md, validation/)
- [ ] Run `npm install`
- [ ] Run `npm run clean && npm run build && npm test`
- [ ] Verify MCP server identity
- [ ] Final grep sweep for old names and paths
- [ ] Update GitHub repo name / git remote URL
- [ ] `git commit -m "refactor: rename shuvdex to shuvdex"`
- [ ] `git push`

---

## Related Files

- `.codex/config.toml` - MCP server registration (gitignored but check if present)
- `.factory/validation/` - 65 files needing bulk update
- `fleet.yaml` - legacy host configuration from the removed fleet-management model (should no longer exist in active runtime paths)
- `.pi/suggester/seed.json` - Generated; reseed after rename for full cleanliness
