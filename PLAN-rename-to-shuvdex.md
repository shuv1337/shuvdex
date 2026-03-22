# PLAN: Rename codex-fleet → shuvdex

> **Context:** Dev-only project, no active users, no backwards compatibility concerns.
> Local directory already renamed to `/home/shuv/repos/shuvdex`. Source/config still says `codex-fleet`.
> Goal: mechanical rename, rebuild, verify, ship.

---

## Phase 1: Bulk find-and-replace

Run these 5 replacements **in order** across all tracked files (excluding `node_modules`, `dist`, `.run`, `*.tsbuildinfo`, `package-lock.json`, and this plan file):

1. `@codex-fleet/` → `@shuvdex/` (scoped package refs — do first to avoid partial hits)
2. `/home/shuv/repos/codex-fleet` → `/home/shuv/repos/shuvdex` (fix 53+ broken absolute paths)
3. `codex-fleet` → `shuvdex` (remaining hyphenated occurrences — package names, temp prefixes, server identity, branding, etc.)
4. `codex_fleet` → `shuvdex` (TOML section names, identifiers)
5. `CodexFleet` → `Shuvdex` (one function + 3 call sites)

- [x] **1.1** Run the 5 bulk replacements
- [x] **1.2** Rename test file: `git mv apps/mcp-server/test/codex-integration.test.ts apps/mcp-server/test/shuvdex-integration.test.ts`

## Phase 2: Manual cleanup

- [x] **2.1** `opencode.jsonc` — normalize the MCP entry to use a stable config, not the dated `.run/ui-demo-*` path
  - **Preferred end-state:** remove the `environment` block entirely and rely on the server defaults (`.capabilities/packages` and `.capabilities/policy`)
  - Result should look like:
    ```jsonc
    "shuvdex": {
      "type": "local",
      "command": ["node", "apps/mcp-server/dist/index.js"],
      "enabled": true
    }
    ```
  - Only keep `environment` if you explicitly need an override; if so, point it at stable `.capabilities/*` paths, never `.run/ui-demo-*`
- [x] **2.2** Optional: `git mv dogfood-output/codex-fleet-2026-03-17/ dogfood-output/shuvdex-2026-03-17/`

## Phase 3: Rebuild and verify

- [x] **3.1** `npm install` (regenerates lockfile with new names)
- [x] **3.2** `npm run clean`
- [x] **3.3** `npm run build`
- [x] **3.4** `npm test`
- [x] **3.5** Verify MCP server identity:
  ```bash
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}' \
    | node apps/mcp-server/dist/index.js 2>/dev/null \
    | jq -r '.result.serverInfo.name'
  # Expected: shuvdex
  ```
- [x] **3.6** Final grep — should return zero hits in tracked source:
  ```bash
  rg "codex-fleet|codex_fleet|CodexFleet|@codex-fleet/" \
    -g '!node_modules' -g '!dist' -g '!.run' -g '!*.tsbuildinfo' \
    -g '!PLAN-rename-to-shuvdex.md'
  ```
- [x] **3.7** Verify lockfile is also clean after install:
  ```bash
  rg "codex-fleet|@codex-fleet/" package-lock.json
  # Expected: no hits
  ```

## Phase 4: Ship

- [x] **4.1** Rename GitHub repo: `shuv1337/codex-fleet` → `shuv1337/shuvdex`
- [x] **4.2** `git remote set-url origin git@github.com:shuv1337/shuvdex.git`
- [x] **4.3** `git add -A && git commit -m "refactor: rename codex-fleet to shuvdex"`
- [x] **4.4** `git push`
