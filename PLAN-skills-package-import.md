# Plan: First-Class Skill File Import

## Summary

Add a first-class import flow for skill files so `codex-fleet` can ingest:

- a standalone Markdown skill file
- a `.zip` archive
- a `.skill` archive

The importer validates the file shape, compiles it into a capability package, persists the imported package metadata in the registry, and exposes the result through the existing REST and MCP discovery surfaces.

## Current State From The Checkout

| Component | File | Current Behavior |
|---|---|---|
| Skill compilation | `packages/skill-indexer/src/live.ts` | `compileSkillDirectory()` reads `SKILL.md` + optional `capability.yaml`/`.yml` from an unpacked directory. Produces a `CompiledSkillArtifact` with a `CapabilityPackage` shape. **Does not parse YAML frontmatter from SKILL.md** — derives title from `# ` headings and summary from the first non-heading paragraph. Frontmatter blocks are stored verbatim in resource content. Does not compile subdirectory files (`prompts/`, `references/`, `templates/`) into individual resource or prompt capabilities — lists them as string paths in `assets` only. |
| Indexer service | `packages/skill-indexer/src/types.ts` | `SkillIndexerService` exposes `compileSkillDirectory(skillPath)` and `indexRepository(repoPath)`. No archive-oriented API. |
| Package schema | `packages/capability-registry/src/schema.ts` | `PackageSource.type` is `"builtin" | "skill" | "manifest" | "connector" | "generated"`. No `imported_skill` variant. No fields for archive metadata (`archivePath`, `importedAt`, `checksum`, etc.). |
| Registry service | `packages/capability-registry/src/live.ts` | `upsertPackage()` overwrites unconditionally — no ownership or provenance guards. Persists one YAML per package to `.capabilities/packages/`. |
| Package API | `apps/api/src/routes/packages.ts` | `GET /api/packages` (list), `POST /api/packages/reindex` (re-scan local repo). No upload/import endpoint. |
| Tools API | `apps/api/src/routes/tools.ts` | Compatibility shim: maps `CapabilityDefinition` (kind=tool) to a flat legacy `Tool` shape for the web UI. Supports CRUD via the registry. |
| Skills API | `apps/api/src/routes/skills.ts` | Read-only: scans local repo via `SkillIndexer.indexRepository()`. Imported packages would not appear. |
| Web client | `apps/web/src/api/client.ts` | Talks to `/api/tools` only. No package or import awareness. |
| Web UI | `apps/web/src/pages/ToolManager.tsx` | Tool-centric CRUD grid. No package import flow. |
| MCP server | `apps/mcp-server/src/index.ts` | Loads registry from `.capabilities/packages/`, indexes local repo, upserts, then serves. Imported packages persist if they exist as YAML in that directory. |
| Storage | `.capabilities/packages/` | One YAML file per package. No `imports/` subdirectory. |
| Dependencies | `packages/skill-indexer/package.json` | No zip/archive extraction library present. |

## Goals

1. Import a standalone `.md` skill file or archived `.zip` / `.skill` package without requiring the skill repo to exist on disk.
2. Preserve the current skill-authoring path for unpacked local skills.
3. Reuse the capability registry as the canonical persisted state after import.
4. Keep imported packages visible through the same package catalog and MCP discovery surfaces as repo-indexed packages.
5. Make failure modes explicit: invalid archive, malformed manifest, duplicate package id, unsupported contents, asset extraction errors, and ownership conflicts.
6. Enforce Claude-compatible metadata and packaging requirements at import time, and surface best-practice warnings when the file is valid but weakly authored.

## Non-Goals

- Replacing the existing local repo indexing flow.
- Package publishing, remote registries, signatures, or trust federation.
- Multi-package marketplace protocol.
- Converting the tool-centric web app into a full package manager in the same change.

## Proposed Product Behavior

### Import UX

An admin-facing import action accepts a skill file upload (`.md`, `.zip`, or `.skill`) and returns a dry-run preview before final persistence:

- Inferred package id and version.
- Title and summary.
- Contained capabilities (resources, prompts, tools).
- Warnings (e.g., missing manifest, unusual structure).
- Asset list.
- Overwrite/conflict status against existing packages.

Explicit confirmation is required to:
- Create a new imported package.
- Replace an existing imported package with the same id.
- Reject import when the id currently belongs to a repo-indexed or built-in package (no silent overwrite).

### Runtime Behavior

- Imported packages persist into `.capabilities/packages/` as normal YAML and are loaded on API and MCP startup like any other package.
- Imported resources/prompts/tools behave identically to repo-indexed packages.
- Package metadata records the source as an imported archive (source type `imported_archive`).
- Reindexing the local repo does not delete or overwrite imported packages.
- Deleting an imported package removes both the YAML and any extracted assets.

## Packaging Model

### Accepted Inputs

- `.md`
  - must be a skill markdown file with YAML frontmatter
  - frontmatter must include `name` and `description`
  - if the markdown references relative paths (`./references/...`, `./templates/...`, etc.), emit a warning: "This skill references N local files not included in the import. Consider importing as a .zip or .skill archive."
- `.zip` or `.skill`
  - must contain a `SKILL.md` file
  - `SKILL.md` must include YAML frontmatter with `name` and `description`
  - may optionally contain a `package.json` with Pi metadata (see Package Metadata Sources below)

### Required Metadata And Packaging Rules

Import validation should follow the linked Claude skill guidance:

- `name` is required
- `description` is required
- `description` should state both what the skill does and when it should be used
- metadata must live in YAML frontmatter at the top of the markdown file (delimited by `---` fences)
- archive inputs should package the skill directory as a single top-level directory (preferred), but flat archives with `SKILL.md` at the root are also accepted (see Archive Root Heuristic below)

Use hard validation for missing frontmatter, missing required fields, invalid archive layout, or missing `SKILL.md`. Treat weaker authoring problems as warnings, not blockers.

### Frontmatter Parsing

**This is a prerequisite for the entire import flow and must also be backported into the existing `compileSkillDirectory()` in `packages/skill-indexer/src/live.ts`.**

The current compiler does not parse YAML frontmatter from `SKILL.md`. It derives title from `# ` headings and summary from the first non-heading paragraph. The raw YAML block is stored verbatim in the instructions resource content, which pollutes the resource with non-instruction metadata.

**Required changes to the compiler (`packages/skill-indexer`):**

1. Add a `parseFrontmatter(markdown: string)` utility that splits `---`-delimited YAML from the markdown body. Use a manual fence parser (split on first and second `---` lines) or add `gray-matter` as a dependency.
2. When frontmatter is present, use `frontmatter.name` for skill name (overriding directory name) and `frontmatter.description` for summary (overriding first-paragraph extraction).
3. Store the **stripped markdown body** (everything after the closing `---`) as the instructions resource content — never include the frontmatter block in resource content.
4. Preserve extra frontmatter fields (`license`, `compatibility`, `version`, and any other keys) as `annotations` on the compiled package: `{ "frontmatter.license": "MIT", "frontmatter.compatibility": "..." }`.
5. Apply frontmatter stripping to all `.md` files compiled into resources, not just `SKILL.md`.

Frontmatter parsing is shared between the compiler and the importer — implement it once in `packages/skill-indexer` and import it from `packages/skill-importer`.

### Package Metadata Sources and Precedence

Multiple metadata sources may exist in a skill directory. When they disagree, apply this precedence (highest wins):

**Package ID derivation:**
1. `capability.yaml` / `capability.yml` → `id` field
2. YAML frontmatter in `SKILL.md` → `name` field (slugified to `skill.<name>`)
3. `package.json` → `name` field
4. Archive directory name (for archives) or file stem (for standalone `.md`)

**Version derivation:**
1. `package.json` → `version` field (e.g., `"0.4.3"`)
2. `capability.yaml` → `version` field
3. Content hash (SHA-1 of SKILL.md + manifest, current compiler behavior)

**Description derivation:**
1. `capability.yaml` → `description` field
2. YAML frontmatter in `SKILL.md` → `description` field
3. First non-heading paragraph from SKILL.md body

**Additional metadata from `package.json`:**

If a `package.json` exists in the skill root, read:
- `pi.skills` — skill root paths (informational, validates structure)
- `pi.prompts` — prompt directory paths (used to discover prompt files for compilation)
- `version` — used for package version per precedence above
- `license` — preserved as `annotations["package.license"]`
- `keywords` — preserved as `annotations["package.keywords"]`
- `description` — fallback only if no frontmatter or manifest description

Emit a warning when ID or version sources disagree: "Package id derived from frontmatter name 'X' but archive directory is named 'Y'."

### Archive Shape

Standardize on zip-compatible archives for `.zip` and `.skill`.

**Required file:**
- `SKILL.md` with YAML frontmatter containing `name` and `description`

**Recognized optional files and directories** (compiled into capabilities or preserved as assets):
- `capability.yaml` or `capability.yml` — structured manifest overlay
- `package.json` — Pi metadata, version, license (see Package Metadata Sources)
- `LICENSE` — preserved as an asset, license value stored in annotations
- `prompts/` — `.md` files compiled into prompt capabilities (see Per-File Resource Compilation)
- `references/` — `.md` files compiled into resource capabilities
- `templates/` — files compiled into resource capabilities
- `examples/` — `.md` files compiled into resource capabilities
- `assets/` — files preserved as assets
- `scripts/` — files preserved as assets with security warnings
- `tests/` — files preserved as assets (not executed during import)

**Any other files or directories are permitted.** The archive shape is open — only `SKILL.md` is required. Unknown directories are preserved as assets without compilation. The plan does not enforce a closed directory allowlist.

### Archive Root Heuristic

The importer accepts two archive layouts:

1. **Wrapped (preferred):** A single top-level directory containing `SKILL.md`. The directory name is used as a fallback skill name. Example: `watchos-dev/SKILL.md`, `watchos-dev/networking.md`.
2. **Flat (accepted):** `SKILL.md` at the archive root with no wrapper directory. The skill name **must** be derived from frontmatter `name` (required in this case since there is no directory name). Example: `SKILL.md`, `references/css-patterns.md`.

**Rejection rules** — reject archives that:
- Are not valid zip files.
- Exceed a configurable size limit (default 10 MB in v1).
- Contain path traversal sequences (`../`).
- Contain symlinks.
- Contain duplicate entries.
- Have multiple unrelated top-level directories (multi-skill archives rejected in v1).
- Are missing `SKILL.md` at the package root (neither wrapped nor flat).
- Are flat archives where `SKILL.md` lacks a frontmatter `name` field (no directory name to fall back on).

### Build Artifact Stripping

During extraction, automatically strip known build artifacts and temporary files before compilation:

**Always strip (silently):**
- `__pycache__/` and `*.pyc` (Python bytecode cache)
- `node_modules/` (npm dependencies — never bundle these)
- `.git/` (version control metadata)
- `.DS_Store` (macOS Finder metadata)
- `*.swp`, `*~` (editor swap/backup files)

**Strip with security warning:**
- `.env` files — likely contain credentials; warn: "Credential file `.env` found and removed. Secrets should not be bundled in skill archives."
- Files matching `*secret*`, `*credential*`, `*token*` patterns — warn and strip.

**Preserve with warning:**
- `.gitignore` — harmless but unnecessary in an imported archive; preserve as asset, emit info-level note.
- Other dot-files (`.eslintrc`, `.prettierrc`, etc.) — preserve as assets, emit info-level note.

### File Permission Preservation

When extracting archives, preserve Unix file permissions from zip external attributes. Specifically:

- Executable bits (`chmod +x`) on scripts and binaries must survive extraction. The `make-api` reference skill contains an executable binary (`make-api`) that requires execute permission.
- If the zip library does not preserve permissions (e.g., `adm-zip`), apply a post-extraction pass: set `0o755` on files with shebang lines (`#!/...`) and known executable extensions, set `0o644` on all other files.
- Prefer `yauzl` which provides access to external file attributes for accurate permission restoration.

### Claude Best-Practice Warnings

For valid imports, emit non-blocking warnings when the skill appears to violate documented best practices. Each warning includes a concrete detection heuristic:

| Warning | Detection heuristic |
|---|---|
| Skill covers multiple unrelated workflows | SKILL.md has 4+ top-level `## ` sections AND < 30% vocabulary overlap between section bodies (measured by shared non-stopword tokens). |
| Description is vague | `description` frontmatter field is < 20 characters, or contains only the skill name with no verb or context. |
| Description not in third person | `description` starts with "I ", "You ", "We ", or an imperative verb without a subject. |
| Name not lowercase-hyphenated | `name` field contains uppercase letters, underscores, spaces, or special characters (expected pattern: `/^[a-z][a-z0-9-]*$/`). |
| SKILL.md is overly long | SKILL.md body (after frontmatter stripping) exceeds 500 lines or 30 KB. |
| No examples provided | No `examples/` directory exists, AND SKILL.md body contains no fenced code blocks (` ``` `) or sections titled "Example" / "Usage". |
| References nested too deep | Any file referenced from SKILL.md is more than 2 directory levels from SKILL.md (e.g., `./references/deep/nested/file.md`). |
| Scripts without dependency clarity | `scripts/` directory exists but no `requirements.txt`, `package.json`, `Pipfile`, or dependency section in SKILL.md. |
| Standalone .md references local files | Standalone `.md` import contains `./` relative path references in the body text (detected by regex `\./[a-zA-Z]`). Emit: "This skill references N local files not included. Consider a .zip or .skill archive." |

### Security And Dependency Checks

Import preview should surface security-oriented warnings for review:

- scripts are present but dependencies are not declared (see Best-Practice Warnings table)
- obvious secrets or credential placeholders appear hardcoded in markdown or bundled scripts (regex scan for patterns like `API_KEY=`, `token:`, `password:`, `sk-`, `ghp_`, `Bearer `)
- archive bundles executable content (files with execute permission or shebang lines) without any usage notes or trust warning
- `.env` files or files matching `*secret*`, `*credential*`, `*token*` patterns are present (these are stripped during extraction — see Build Artifact Stripping)
- archive contains compiled/binary files (`.pyc`, `.class`, `.o`, `.so`, `.dll`, `.exe`) that may indicate bundled dependencies or untrusted binaries

These should remain warnings in v1 unless a clearly unsafe pattern is detected during parsing. Build artifact stripping (see above) handles the most common cases automatically.

### Import Metadata

Extend `PackageSource` in `packages/capability-registry/src/schema.ts`:

```typescript
// Current:
type: "builtin" | "skill" | "manifest" | "connector" | "generated"

// After:
type: "builtin" | "skill" | "manifest" | "connector" | "generated" | "imported_archive"
```

Add optional fields to `PackageSource`:

```typescript
archiveName?: string    // original filename of the uploaded archive
importedAt?: string     // ISO timestamp of import
checksum?: string       // SHA-256 hex digest of the archive file
importMode?: string     // "upload" (v1), future: "url", "cli"
```

This keeps the persistence model aligned with the existing package schema. No parallel import database.

## Architecture Changes

### 1. New `SkillImporter` Service (New Package: `packages/skill-importer`)

**Why a separate package instead of expanding `skill-indexer`:**

The skill indexer's concern is *compiling directories* and *scanning repositories*. Archive extraction, zip security validation, temp-dir lifecycle management, asset persistence, and conflict detection are fundamentally different concerns. Mixing them into the indexer violates SRP and makes the indexer harder to test in isolation.

Create `packages/skill-importer` with its own Effect service:

```typescript
// packages/skill-importer/src/types.ts

interface ArchiveInspection {
  readonly packageId: string
  readonly version: string
  readonly title: string
  readonly summary: string
  readonly capabilities: ReadonlyArray<{ id: string; kind: CapabilityKind; title: string }>
  readonly assets: ReadonlyArray<string>
  readonly warnings: ReadonlyArray<string>
  readonly conflicts: ReadonlyArray<ImportConflict>
  readonly checksum: string
  readonly originalFilename: string
  readonly annotations: Readonly<Record<string, string>>  // extra frontmatter + package.json metadata
  readonly metadataSources: {                              // transparency: show where each field came from
    readonly packageId: string                             // e.g., "frontmatter.name" | "capability.yaml" | "directory"
    readonly version: string                               // e.g., "package.json" | "content-hash"
    readonly description: string                           // e.g., "frontmatter" | "capability.yaml"
  }
}

interface ImportConflict {
  readonly packageId: string
  readonly existingSourceType: string   // "skill" | "builtin" | "imported_archive" | etc.
  readonly resolution: "replaceable" | "blocked"
  readonly reason: string
}

interface ImportResult {
  readonly package: CapabilityPackage
  readonly extractedAssets: ReadonlyArray<string>
  readonly replaced: boolean
}

interface SkillImporterService {
  readonly inspectMarkdownFile: (
    filePath: string,
    originalFilename: string,
  ) => Effect<ArchiveInspection, ArchiveValidationError>

  readonly inspectArchive: (
    archivePath: string,
    originalFilename: string,
  ) => Effect<ArchiveInspection, ArchiveValidationError>

  readonly importFile: (
    filePath: string,
    originalFilename: string,
    options?: { force?: boolean },
  ) => Effect<ImportResult, ArchiveValidationError | ImportConflictError | CapabilityRegistryIOError>
}

class SkillImporter extends Context.Tag("SkillImporter")<
  SkillImporter,
  SkillImporterService
>() {}
```

**Dependencies:**
- `@codex-fleet/skill-indexer` — reuses `compileSkillDirectory()` for compilation after extraction, and the shared `parseFrontmatter()` utility for YAML frontmatter parsing.
- `@codex-fleet/capability-registry` — checks for conflicts, persists the final package.
- `yauzl` — zip extraction with Unix permission support. Add as a new dependency. Prefer over `adm-zip` because `yauzl` provides access to external file attributes for accurate permission restoration.

**Implementation flow:**

`inspectMarkdownFile(filePath, originalFilename)`:
1. Read the file and call `parseFrontmatter()` to split YAML metadata from markdown body.
2. Validate required `name` and `description` in frontmatter. Fail with `ArchiveValidationError` if missing.
3. Preserve extra frontmatter fields (`license`, `compatibility`, etc.) as annotations.
4. Scan the markdown body for relative path references (`./references/...`, `./templates/...`). If found, emit warning: "This skill references N local files not included in the import."
5. Emit best-practice warnings per the heuristic table (description quality, naming, length, examples).
6. Compile the stripped markdown body (frontmatter removed) into a single-file skill package with summary resource, instructions resource, and apply prompt.
7. Derive package id and version per the Package Metadata Sources precedence rules.
8. Query the registry for the compiled package id to detect conflicts.
9. Return `ArchiveInspection` with capabilities, warnings, conflicts.

`inspectArchive(archivePath, originalFilename)`:
1. Validate zip structure (reject non-zip, path traversal, symlinks, oversized).
2. Extract to a temp directory, preserving Unix file permissions from zip external attributes.
3. Strip build artifacts (`__pycache__/`, `node_modules/`, `.git/`, `*.pyc`, `.DS_Store`, editor swap files). Strip `.env` and credential-pattern files with security warnings.
4. Apply the archive root heuristic: if a single top-level directory contains `SKILL.md`, use it as root. If `SKILL.md` is at the archive root (flat layout), treat the archive root as the skill directory and require frontmatter `name`. Reject if neither pattern matches.
5. Parse YAML frontmatter from `SKILL.md` via `parseFrontmatter()`. Validate required `name` and `description`. Preserve extra fields as annotations.
6. If `package.json` exists, read `pi.prompts`, `pi.skills`, `version`, `license`, `keywords` per Package Metadata Sources rules.
7. Emit best-practice warnings per the heuristic table (description quality, naming, length, examples, script dependencies).
8. Call `compileSkillDirectory(extractedRoot)` from the skill indexer (plain function, not the Effect service). The updated compiler will parse frontmatter, strip it from resource content, and compile subdirectory files into per-file resources and prompts (see Per-File Resource Compilation).
9. Compute SHA-256 checksum of the archive file.
10. Derive package id and version per the Package Metadata Sources precedence rules. Warn if sources disagree.
11. Query the registry for the compiled package id to detect conflicts.
12. Return `ArchiveInspection` with capabilities, warnings, conflicts.
13. Clean up temp directory.

`importFile(filePath, originalFilename, options)`:
1. Dispatch to `inspectMarkdownFile(...)` for `.md` or `inspectArchive(...)` for `.zip` / `.skill`.
2. If conflicts exist and `options.force !== true`, fail with `ImportConflictError`.
3. If the conflicting package is `builtin` or `skill` (repo-indexed), fail unconditionally (no force override in v1).
4. Copy source files to `.capabilities/imports/<packageId>/<version>/`.
5. Rewrite the compiled package's `source` to `{ type: "imported_archive", archiveName, importedAt, checksum, importMode: "upload" }`.
6. Rewrite asset paths from temp dir or source file location to managed import dir.
7. `upsertPackage(...)` into the registry.
8. Clean up temp directory when applicable.
9. Return `ImportResult`.

### 2. Managed Import Storage

```
.capabilities/
├── packages/                           # Package YAML definitions (existing)
│   ├── builtin.fleet.yaml
│   └── skill.visual_explainer.yaml     # ← imported package YAML goes here too
└── imports/                            # Extracted archive assets (new)
    └── skill.visual_explainer/
        └── 0.4.3/
            ├── SKILL.md
            ├── capability.yaml          # optional
            ├── package.json             # optional, read for Pi metadata
            ├── LICENSE
            ├── prompts/
            │   ├── plan-review.md       # → compiled into prompt capability
            │   ├── diff-review.md
            │   └── ...
            ├── references/
            │   ├── css-patterns.md      # → compiled into resource capability
            │   ├── libraries.md
            │   └── ...
            ├── templates/
            │   ├── architecture.html    # → compiled into resource capability
            │   └── ...
            └── assets/
                └── banner.png           # → preserved, URI-addressable
```

The YAML package definition persists in `packages/` like any other package. The `imports/` directory holds the extracted source files so that:
- Resource `contents` fields for `.md` and text files are loaded from these files.
- Binary assets (images, etc.) are served from disk on `resources/read` via their `uri`.
- The full directory structure is preserved so that relative path references within SKILL.md continue to resolve.
- Asset paths survive restarts.
- Deletion can clean up both YAML and extracted files.

### Per-File Resource Compilation

**This is the mechanism that makes multi-file skills useful through MCP.**

The current `compileSkillDirectory()` creates exactly 3 capabilities: a summary resource, a full instructions resource (entire SKILL.md), and an apply prompt. All other files are listed as string paths in `assets[]`. This means subdirectory files like `references/css-patterns.md` or `prompts/plan-review.md` are invisible to MCP clients — they can't be discovered or read.

**Required enhancement to `compileSkillDirectory()` in `packages/skill-indexer/src/live.ts`:**

After compiling the base 3 capabilities (summary, instructions, apply prompt), scan recognized subdirectories and compile each `.md` file into an additional capability:

**`references/*.md` → resource capabilities:**
```
id: <packageId>.ref.<filename_slug>
kind: resource
uri: skill://<skillName>/references/<filename>
mimeType: text/markdown
contents: <stripped markdown body, frontmatter removed>
```

**`templates/*.html` (and other template files) → resource capabilities:**
```
id: <packageId>.tpl.<filename_slug>
kind: resource
uri: skill://<skillName>/templates/<filename>
mimeType: text/html (or appropriate MIME type)
contents: <file content>
```

**`examples/*.md` → resource capabilities:**
```
id: <packageId>.example.<filename_slug>
kind: resource
uri: skill://<skillName>/examples/<filename>
mimeType: text/markdown
contents: <stripped markdown body>
```

**`prompts/*.md` → prompt capabilities:**

Prompt files with YAML frontmatter (e.g., `prompts/plan-review.md` with `description: "..."`) are compiled into prompt capabilities:
```
id: <packageId>.prompt.<filename_slug>
kind: prompt
arguments: [{ name: "input", description: <frontmatter.description>, required: false }]
attachedResourceIds: [<packageId>.instructions, ...referenced resources]
messages: [{ role: "user", content: <stripped markdown body> }]
```

Prompt files without frontmatter are compiled as resources instead (same as `references/`).

**Discovery of prompt directories:**

The compiler checks for prompt files in this order:
1. Directories listed in `package.json` → `pi.prompts` (e.g., `["./prompts"]`)
2. A `prompts/` directory at the skill root (default convention)
3. No prompt directory found → skip prompt compilation

**Non-markdown files** in recognized directories (e.g., `templates/architecture.html`, `assets/banner.png`) are compiled as resources with appropriate MIME types. Binary files use `contents: undefined` and store only the `uri` pointing to the managed import path — the content is served from disk on `resources/read`.

**Progressive disclosure is preserved:** `resources/list` returns compact metadata (id, uri, mimeType, summary). Full content is returned only on `resources/read`. This prevents large skills from bloating the capability catalog.

**Capability count impact:** A skill like `visual-explainer` would produce ~20 capabilities (1 summary + 1 instructions + 1 apply prompt + 7 prompts + 4 references + 5 templates + optional binary asset resources) instead of the current 3. This is expected and correct — it makes the full skill content discoverable and readable through MCP.

### 3. Registry Ownership and Conflict Rules

Add ownership-aware guards. These belong in the `SkillImporter` service (not in the registry itself), since the registry is a general-purpose store and should remain agnostic to import semantics.

**Conflict rules:**

| Existing source type | Import action | Result |
|---|---|---|
| None (new id) | Import | ✅ Create |
| `imported_archive` | Import same id | ✅ Replace (update) |
| `imported_archive` | Import same id, same checksum | ⚠️ No-op with warning |
| `skill` or `manifest` | Import same id | ❌ Blocked — repo-indexed skills own their id |
| `builtin` | Import same id | ❌ Blocked — built-in packages are immutable |
| `generated` | Import same id | ✅ Replace (generated packages are transient) |

**Reindex protection:**

The existing `refreshRegistry()` in `apps/api/src/routes/packages.ts` calls `registry.upsertPackage()` for every repo-indexed artifact. This would silently overwrite an imported package if the repo later adds a skill with the same id.

Fix: update `refreshRegistry()` to skip upsert when the existing package has `source.type === "imported_archive"`. Log a warning instead. This is a small change in `packages.ts` and `mcp-server/src/index.ts`.

**Orphan cleanup:**

If a package YAML is manually deleted but the `.capabilities/imports/<packageId>/` directory remains, the import directory becomes orphaned. Add orphan detection to the reindex flow:

1. On reindex, scan `.capabilities/imports/` for directories that have no matching package YAML in `.capabilities/packages/`.
2. Log a warning for each orphan: "Orphaned import directory found for package '<packageId>' with no matching package definition."
3. Do not auto-delete orphans in v1 — manual cleanup only. Add a `POST /api/packages/cleanup` endpoint that lists and optionally removes orphaned import directories with explicit confirmation.

### 4. REST Import Endpoints

Extend `apps/api/src/routes/packages.ts`:

```typescript
// POST /api/packages/import/inspect
// Accepts: multipart/form-data with field "file" (upload)
// Returns: ArchiveInspection JSON
// Does NOT persist anything

// POST /api/packages/import
// Accepts: multipart/form-data with field "file" + optional "force" field
// Returns: ImportResult JSON
// Persists package YAML and extracted assets
```

**Implementation notes:**

- Use Hono's `c.req.parseBody()` for multipart handling (built-in, no extra dependency).
- Write uploaded file to a temp path before passing to the importer.
- Route validation by uploaded filename and content:
  - `.md` expects YAML frontmatter with `name` and `description`
  - `.zip` / `.skill` expect a `SKILL.md`
- Enforce archive size limit at the HTTP layer (reject before writing if `Content-Length` exceeds limit).
- Clean up temp upload file after import completes or fails.
- Map importer errors to HTTP status codes:
  - `ArchiveValidationError` → 400
  - `ImportConflictError` → 409
  - `CapabilityRegistryIOError` → 500

**Add a delete endpoint for imported packages:**

```typescript
// DELETE /api/packages/:packageId
// If source.type === "imported_archive", also remove .capabilities/imports/<packageId>/
// Returns: { deleted: true }
```

This extends the existing `deletePackage` registry call with asset cleanup.

### 5. Update Skills API Read Model

Update `apps/api/src/routes/skills.ts` to surface both repo-indexed and imported skills:

```typescript
// GET /api/skills
// Current: only returns repo-indexed skills
// After: returns repo-indexed skills + imported skill packages

// Add provenance field to each skill record:
{
  skill: string,
  packageId: string,
  version: string,
  warnings: string[],
  hosts: {},
  source: "local_repo" | "imported_archive"   // new
}
```

Implementation: after repo indexing, query the registry for packages with `source.type === "imported_archive"`, map them to the same lightweight shape, and merge into the response.

### 6. Minimal Web Import Support

Phase 1 web scope — pragmatic additions to the existing tool-centric UI:

**`apps/web/src/api/client.ts`:**
```typescript
inspectSkillFile(file: File): Promise<ArchiveInspection>
importSkillFile(file: File, force?: boolean): Promise<ImportResult>
```

**`apps/web/src/pages/ToolManager.tsx`:**
- Add an "Import Skill File" button in the toolbar area.
- On click: file picker (accept `.md,.zip,.skill`).
- On file selected: call `inspectSkillFile()`, show preview modal with:
  - Package id, title, version.
  - Capabilities list.
  - Warnings.
  - Conflict status (if any).
- Confirm button calls `importSkillFile()`.
- On success: refresh tool/package lists.
- On error: show structured error message.

Do not redesign the full page. The import action is a secondary admin feature in the existing UI.

### 7. MCP Behavior — No Protocol Changes

No changes needed to MCP protocol handling in `apps/mcp-server/src/server.ts`. Imported packages are persisted as normal YAML in `.capabilities/packages/` and loaded on startup like any other package.

**Required verification only:**
- Imported tool capabilities appear in `tools/list`.
- Imported resource contents are readable after restart.
- Imported prompts still resolve attached resource ids.

**Required code change in `apps/mcp-server/src/index.ts`:**
- Same reindex-protection as the API: skip upsert for imported packages when re-scanning the local repo.

## Implementation Phases

### Phase 1: Schema, Frontmatter Parser, and Service Contracts

- [x] Add `"imported_archive"` to `PackageSource.type` in `packages/capability-registry/src/schema.ts`.
- [x] Add optional fields to `PackageSource`: `archiveName`, `importedAt`, `checksum`, `importMode`.
- [x] Export updated types from `packages/capability-registry/src/index.ts`.
- [x] **Implement `parseFrontmatter()` in `packages/skill-indexer/src/frontmatter.ts`** — splits `---`-delimited YAML from markdown body. Returns `{ frontmatter: Record<string, unknown>, body: string }`. Export from `packages/skill-indexer/src/index.ts` for use by both indexer and importer.
- [x] **Backport frontmatter parsing into `compileSkillDirectory()`** in `packages/skill-indexer/src/live.ts`:
  - [x] Use `parseFrontmatter()` to extract metadata from `SKILL.md`.
  - [x] Use frontmatter `name` for skill name when present (override directory name).
  - [x] Use frontmatter `description` for summary when present (override first-paragraph extraction).
  - [x] Store stripped markdown body (frontmatter removed) in instructions resource content.
  - [x] Preserve extra frontmatter fields as package `annotations`.
  - [x] Apply frontmatter stripping to all `.md` files read during compilation.
- [x] **Add `package.json` reading to `compileSkillDirectory()`** — if `package.json` exists, read `pi.prompts`, `version`, `license`, `keywords`. Apply version/metadata precedence rules.
- [x] Create `packages/skill-importer/` package scaffold: `package.json`, `tsconfig.json`, `src/types.ts`, `src/errors.ts`, `src/index.ts`.
- [x] Define `SkillImporterService` interface, `ArchiveInspection` (with `annotations` and `metadataSources` fields), `ImportConflict`, `ImportResult` types.
- [x] Define error types: `ArchiveValidationError`, `ImportConflictError`.
- [x] Add `yauzl` dependency to `packages/skill-importer/package.json` (prefer over `adm-zip` for Unix permission support).
- [x] Register the new package in root `package.json` workspaces (already covered by `packages/*` glob) and `turbo.json` if needed.
- [x] Define best-practice warning rules with concrete detection heuristics (see heuristic table in Best-Practice Warnings section).
- [x] Define build artifact stripping rules (see Build Artifact Stripping section).
- [x] Define preview warnings for obvious hardcoded secrets or undeclared script dependencies (regex patterns for credential scanning).

### Phase 2: Archive Inspection, Extraction, and Per-File Compilation

- [x] **Implement per-file resource compilation in `compileSkillDirectory()`** — scan `references/`, `templates/`, `examples/` for `.md` and other files, compile each into resource capabilities. Scan `prompts/` for `.md` files with frontmatter and compile into prompt capabilities. (See Per-File Resource Compilation section.)
- [x] Implement `inspectMarkdownFile()` for standalone `.md` imports — parse frontmatter, validate required fields, scan for relative path references and warn, compile single-file skill.
- [x] Implement `extractAndValidateArchive()`: zip validation, path traversal check, symlink check, size limit, temp-dir extraction with Unix permission preservation.
- [x] **Implement build artifact stripping** during extraction — remove `__pycache__/`, `node_modules/`, `.git/`, `*.pyc`, `.DS_Store`, editor swap files. Strip `.env` and credential-pattern files with security warnings.
- [x] **Implement archive root heuristic** — detect wrapped (single top-level directory) or flat (`SKILL.md` at root) layout. Reject flat archives without frontmatter `name`.
- [x] Implement `inspectArchive()`: extract → strip artifacts → apply root heuristic → validate `SKILL.md` + frontmatter → read `package.json` if present → compile via `compileSkillDirectory()` → checksum → apply metadata precedence → warn on source disagreement → conflict check → cleanup.
- [x] **Implement file permission preservation** — after extraction, restore Unix permissions from zip external attributes. Fallback: set `0o755` on shebang files, `0o644` on others.
- [x] Implement `importFile()`: inspect markdown or archive → conflict guard → copy to `.capabilities/imports/` → rewrite source metadata → upsert → cleanup.
- [x] Ensure repeated imports of identical archives are idempotent (same checksum → no-op with warning).
- [x] Handle the case where `compileSkillDirectory()` is called on the extracted temp path — the compiled `source.path` and all resource `contents` paths must be rewritten to the managed import path before persistence.
- [x] **Verify with reference skills:** import `examples/watchos-dev.skill`, `examples/visual-explainer/` (as zip), and `examples/make-api/SKILL.md` (as standalone). Confirm each produces the expected capabilities, warnings, and metadata.

### Phase 3: Registry Integration and Reindex Protection

- [x] Update `refreshRegistry()` in `apps/api/src/routes/packages.ts` to skip upsert for packages with `source.type === "imported_archive"`.
- [x] Apply the same guard in `apps/mcp-server/src/index.ts` startup indexing loop.
- [x] Extend `deletePackage` handling to clean up `.capabilities/imports/<packageId>/` when deleting imported packages (can be done in the API route or as a registry wrapper).
- [x] Verify that `readPackages()` in the registry correctly loads packages with the new `imported_archive` source type (Schema should decode the extended union).
- [x] **Add orphan detection to reindex flow**: scan `.capabilities/imports/` for directories with no matching package YAML. Log warnings for each orphan.
- [x] **Add `POST /api/packages/cleanup` endpoint**: lists orphaned import directories and optionally removes them with explicit confirmation. Returns `{ orphans: string[], removed: string[] }`.

### Phase 4: API Surface

- [x] Add `POST /api/packages/import/inspect` — multipart upload, calls `inspectArchive()`, returns preview.
- [x] Add `POST /api/packages/import` — multipart upload + optional force flag, calls `importFile()`, returns result.
- [x] Add `DELETE /api/packages/:packageId` — with imported asset cleanup.
- [x] Update `GET /api/skills` to include imported packages with `source: "imported_archive"` provenance.
- [x] Add the `SkillImporter` service to the API's Effect runtime layer.
- [x] Write API tests (see Validation Plan below).

### Phase 5: Web UI

- [x] Add `inspectSkillFile()` and `importSkillFile()` to `apps/web/src/api/client.ts`.
- [x] Add "Import Skill File" button and preview/confirm modal to `ToolManager.tsx`.
- [x] Show import provenance badge on imported tool cards.
- [x] Show actionable error messages for validation and conflict failures.
- [x] Refresh tool list after successful import.

## Validation Plan

### Unit Tests — `packages/skill-indexer` (frontmatter and per-file compilation)

- `parseFrontmatter()` extracts YAML frontmatter and returns stripped body.
- `parseFrontmatter()` returns empty frontmatter and full body when no `---` fences are present.
- `parseFrontmatter()` handles frontmatter with extra fields (`license`, `compatibility`) — all fields preserved.
- `compileSkillDirectory()` on a skill with frontmatter uses frontmatter `name` for package id and `description` for summary.
- `compileSkillDirectory()` strips frontmatter from instructions resource content — no `---` blocks in resource body.
- `compileSkillDirectory()` preserves extra frontmatter fields as package annotations (`frontmatter.license`, etc.).
- `compileSkillDirectory()` on a skill with `references/*.md` produces one resource capability per file.
- `compileSkillDirectory()` on a skill with `prompts/*.md` (with frontmatter) produces prompt capabilities.
- `compileSkillDirectory()` on a skill with `prompts/*.md` (without frontmatter) produces resource capabilities.
- `compileSkillDirectory()` on a skill with `templates/*.html` produces resource capabilities with `mimeType: text/html`.
- `compileSkillDirectory()` reads `package.json` → `pi.prompts` to discover prompt directories.
- `compileSkillDirectory()` uses `package.json` → `version` when present (overrides content hash).
- `compileSkillDirectory()` on `examples/visual-explainer` produces ~20 capabilities (1 summary + 1 instructions + 1 apply prompt + 7 prompts + 4 references + 5 templates).
- `compileSkillDirectory()` on `examples/make-api` produces base capabilities plus asset listings for scripts.
- Per-file resources have correct URIs: `skill://<name>/references/<filename>`, etc.

### Unit Tests — `packages/skill-importer`

- Valid standalone `.md` skill file with YAML frontmatter produces correct `ArchiveInspection`.
- Valid `.zip` / `.skill` archive with `SKILL.md` produces correct `ArchiveInspection`.
- Markdown file missing YAML frontmatter fails with `ArchiveValidationError`.
- Markdown file missing `name` or `description` fails with `ArchiveValidationError`.
- Standalone `.md` with relative path references (`./references/...`) emits warning about missing local files.
- Archive missing `SKILL.md` fails with `ArchiveValidationError`.
- Invalid zip (not a zip file) fails with `ArchiveValidationError`.
- Archive with path traversal (`../`) fails with `ArchiveValidationError`.
- Archive exceeding size limit fails with `ArchiveValidationError`.
- **Wrapped archive** (single top-level directory with `SKILL.md`) correctly locates package root.
- **Flat archive** (`SKILL.md` at zip root) correctly uses archive root as package root and derives name from frontmatter.
- **Flat archive without frontmatter `name`** fails with `ArchiveValidationError`.
- Archives with multiple top-level directories fail with `ArchiveValidationError`.
- Build artifacts stripped: `__pycache__/`, `node_modules/`, `.git/`, `*.pyc`, `.DS_Store` are absent after extraction.
- `.env` files stripped with security warning in inspection result.
- File permissions preserved: executable files extracted from archive retain execute bits.
- Manifest overrides markdown-derived defaults (same behavior as directory compilation).
- `package.json` version overrides content hash. `package.json` `pi.prompts` discovers prompt directories.
- `metadataSources` in inspection result correctly attributes each field to its source.
- Warning emitted when package id sources disagree (frontmatter name vs. directory name vs. package.json name).
- Asset paths in the compiled package point to managed import dir, not temp dir.
- Importing over an existing `imported_archive` package succeeds (replace).
- Importing over a `skill`-sourced package fails with `ImportConflictError`.
- Importing over a `builtin`-sourced package fails with `ImportConflictError`.
- Importing an identical archive (same checksum) is a no-op with warning.
- Valid skill with vague description (< 20 chars) emits best-practice warning without blocking import.
- Valid skill with SKILL.md > 500 lines emits "overly long" warning.
- Valid skill with no examples emits warning.
- Valid skill with scripts/ but no dependency declaration emits warning.
- Temp directories are cleaned up after both success and failure.

### Unit Tests — `packages/capability-registry`

- `PackageSource` with `type: "imported_archive"` and extended fields passes Schema validation.
- Persisted YAML with imported source metadata survives load/save roundtrip.
- Package with `annotations` containing frontmatter and package.json metadata survives load/save roundtrip.

### API Tests — `apps/api`

- `POST /api/packages/import/inspect` returns preview without persistence.
- `POST /api/packages/import/inspect` returns per-file capabilities for multi-file archives (resources for references, prompts for prompt files).
- `POST /api/packages/import/inspect` returns `metadataSources` showing provenance of each derived field.
- `POST /api/packages/import/inspect` returns `annotations` with extra frontmatter and package.json metadata.
- `POST /api/packages/import` persists a valid `.md`, `.zip`, or `.skill` package; package appears in `GET /api/packages`.
- Invalid archive returns 400 with structured error.
- Conflict with repo-indexed package returns 409.
- `DELETE /api/packages/:packageId` removes both YAML and extracted assets for imported packages.
- `GET /api/skills` includes imported packages with correct provenance.
- `POST /api/packages/reindex` does not overwrite imported packages.
- `POST /api/packages/cleanup` lists orphaned import directories and removes them on confirmation.

### Integration Tests — `apps/mcp-server`

- Imported tool capability appears in `tools/list` after startup.
- Imported resource can be read after process restart.
- Imported prompt resolves attached resources.
- Startup reindex does not remove imported packages.
- Per-file resources from subdirectories (references, templates) appear in `resources/list` with compact metadata.
- `resources/read` on a per-file resource returns the full file content (frontmatter stripped for .md files).
- `resources/read` on a binary asset resource (e.g., `banner.png`) returns the file content from the managed import directory.
- Per-file prompt capabilities appear in `prompts/list` and resolve their attached resource ids.
- Imported skill with 20+ capabilities correctly serves all of them through MCP.

### Test Fixtures

Create test fixture archives in `packages/skill-importer/test/fixtures/`:

**Minimal fixtures (synthetic):**
- `valid-skill.skill` — minimal valid archive with `SKILL.md` and frontmatter.
- `valid-skill.zip` — equivalent valid zip fixture.
- `valid-flat.skill` — flat archive with `SKILL.md` at archive root (no wrapper directory).
- `valid-flat-no-name.skill` — flat archive with `SKILL.md` that lacks frontmatter `name` (should fail).
- `valid-with-manifest.skill` — includes `capability.yaml`.
- `valid-with-assets.skill` — includes `assets/` directory with a binary file.
- `valid-standalone.md` — single-file skill with valid YAML frontmatter.
- `standalone-with-refs.md` — single-file skill whose body references `./references/...` (should warn).
- `missing-skillmd.skill` — archive without `SKILL.md`.
- `missing-frontmatter.md` — markdown without YAML metadata.
- `path-traversal.skill` — archive with `../` in entry paths.
- `oversized.skill` — archive exceeding size limit (or mock this).
- `with-build-artifacts.skill` — archive containing `__pycache__/`, `*.pyc`, `.DS_Store` (should be stripped).
- `with-env-file.skill` — archive containing `.env` with fake credentials (should be stripped with security warning).
- `multi-root.skill` — archive with two unrelated top-level directories (should fail).

**Reference skill fixtures (copied from `examples/`):**
- Use `examples/watchos-dev.skill` directly as a real-world `.skill` archive fixture — 8 files, wrapped layout, frontmatter with `name` + `description` + `compatibility`.
- Zip `examples/visual-explainer/` into a fixture — 20+ files across `prompts/`, `references/`, `templates/`, includes `package.json` with Pi metadata, `banner.png` binary asset, `LICENSE`. Tests per-file resource compilation, prompt compilation, package.json reading, version derivation, and annotation preservation.
- Use `examples/make-api/SKILL.md` as a standalone `.md` fixture — tests standalone import with relative reference warnings (references `scripts/`, `tests/` which aren't included).
- Zip `examples/make-api/` into a fixture — tests build artifact stripping (`__pycache__/`), executable permission preservation (`make-api` binary), and security warnings for scripts without declared dependencies.

These reference fixtures ensure the importer handles real-world skill structures, not just synthetic minimal cases.

### Workspace Gates

```bash
# Per-package during development:
npm run test -- --filter=@codex-fleet/skill-importer
npm run test -- --filter=@codex-fleet/capability-registry
npm run test -- --filter=@codex-fleet/api
npm run test -- --filter=@codex-fleet/mcp-server

# Full gates before merge:
npm run typecheck
npm run test
```

## Resolved Decisions

| Decision | Resolution | Rationale |
|---|---|---|
| Accepted file types | `.md`, `.zip`, and `.skill` | Matches the explicit file requirements |
| Bare markdown imports | Allowed for single-file skills only; warn if body references local files | Keeps simple skills easy while surfacing broken references proactively |
| Archive container | `.zip` and `.skill` are both zip-compatible containers in v1 | Simplest implementation with clear user-facing file support |
| Archive format | Zip only in v1 | Simplest, widest tooling support; tarball can be added later |
| Archive root layout | Accept both wrapped (single top-level dir) and flat (`SKILL.md` at root) | Users create zips both ways; flat archives require frontmatter `name` for ID derivation |
| Directory allowlist | Open — any files/directories permitted; only `SKILL.md` required | Real skills have diverse structures (`scripts/`, `tests/`, `prompts/`, `templates/`); a closed allowlist breaks real-world imports |
| Multi-skill archives | Rejected in v1 | Keeps import semantics simple; one archive = one package |
| Conflict UX | Inspect first (dry-run), then confirm; force flag for replacing imported packages only | Two-step flow prevents accidents; force only allowed for replaceable sources |
| Source trust | Unsigned local import acceptable in v1 | Trust federation is a non-goal; checksum stored for integrity tracking |
| Service architecture | New `skill-importer` package, not expanded `skill-indexer` | SRP — indexer compiles/scans, importer handles archives/conflicts/storage |
| Frontmatter parsing | Backported into `compileSkillDirectory()`, shared with importer | Current compiler ignores frontmatter — every SKILL.md in the wild uses it; this is a prerequisite, not a nice-to-have |
| Frontmatter stripping | Always strip from stored resource content | Raw YAML blocks in instructions pollute agent context with non-instruction metadata |
| Extra frontmatter fields | Preserved as package `annotations` | Real skills have `license`, `compatibility`, etc. that should not be silently dropped |
| package.json awareness | Read `pi.prompts`, `version`, `license`, `keywords` when present | visual-explainer uses `package.json` for version and prompt directory hints; ignoring it loses structured metadata |
| Package ID precedence | capability.yaml `id` > frontmatter `name` > package.json `name` > directory name | Multiple sources may exist; clear precedence prevents ambiguity |
| Version precedence | package.json `version` > capability.yaml `version` > content hash | Explicit version strings are more meaningful than hashes |
| Per-file resource compilation | Compile `.md` files in `references/`, `templates/`, `examples/`, `prompts/` into individual capabilities | Without this, multi-file skills are invisible to MCP — subdirectory content can't be discovered or read |
| Prompt compilation | `.md` files in `prompts/` with frontmatter become prompt capabilities; without frontmatter become resources | Prompt template files like `prompts/plan-review.md` have structured metadata that maps naturally to MCP prompts |
| Build artifact stripping | Auto-strip `__pycache__/`, `node_modules/`, `.git/`, `*.pyc`, `.DS_Store`; strip `.env` with warning | make-api reference skill contains `__pycache__/` — common in real skills; `.env` files are a security risk |
| File permissions | Preserve Unix permissions from zip external attributes | make-api has an executable binary; lost permissions break runtime execution |
| Zip library | `yauzl` (not `adm-zip`) | `yauzl` provides access to external file attributes for accurate Unix permission restoration |
| Conflict enforcement location | In `SkillImporter` service, not in the registry | Registry remains a general-purpose store; import policy is an import concern |
| Reindex protection | Skip upsert for `imported_archive` packages during repo reindex | Prevents accidental overwrite; logs warning if repo adds conflicting id |
| Orphan cleanup | Detect orphaned import dirs on reindex; manual cleanup via API in v1 | Prevents silent accumulation of orphaned files without risking accidental data loss |
| Import deletion | Clean up both YAML and `imports/` directory | No orphaned assets after package removal |
| API surface | `/api/packages/import/*`, not `/api/skills/import/*` | `/api/packages` is the canonical package-management surface |
| Best-practice enforcement | Required metadata/layout block import; authoring quality issues surface as warnings with concrete heuristics | Separates file validity from skill quality guidance; heuristics are testable and deterministic |
| Reference skill fixtures | Use `examples/` skills as real-world test fixtures alongside synthetic minimal fixtures | Synthetic fixtures miss real-world complexity; reference skills ensure the importer handles actual skill structures |
