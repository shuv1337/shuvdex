# Runbook: Package Lifecycle

Packages are the unit of deployment in shuvdex. Each package groups one or more capabilities (tools, resources, prompts) under a shared manifest (`capability.yaml`). This runbook covers the full lifecycle from registration through deletion.

**Base URL:** `http://localhost:3847` (override with `SHUVDEX_API_URL`)
**Auth header:** `Authorization: Bearer <token>` (required when auth is enabled)

---

## Contents

1. [List all packages and their status](#1-list-all-packages-and-their-status)
2. [Register a package via YAML (local repo)](#2-register-a-package-via-yaml-local-repo)
3. [Register a package via archive upload](#3-register-a-package-via-archive-upload)
4. [Inspect an archive before import](#4-inspect-an-archive-before-import)
5. [Reindex packages from local repo](#5-reindex-packages-from-local-repo)
6. [Enable a capability within a package](#6-enable-a-capability-within-a-package)
7. [Disable a capability within a package](#7-disable-a-capability-within-a-package)
8. [Rollback: re-upload a previous archive version](#8-rollback-re-upload-a-previous-archive-version)
9. [Delete a package](#9-delete-a-package)
10. [Orphan cleanup](#10-orphan-cleanup)

---

## 1. List all packages and their status

```bash
curl -s http://localhost:3847/api/packages | jq .
```

To force a reindex from the local repo before listing:

```bash
curl -s "http://localhost:3847/api/packages?refresh=1" | jq .
```

**Response fields:**
- `id` — unique package identifier (e.g. `skill.module_runtime_template`)
- `version` — semver string
- `title` / `description`
- `enabled` — whether the package is active
- `builtIn` — true for platform-shipped packages
- `source.type` — `local_repo`, `imported_archive`, or `generated`
- `capabilities` — array of capability definitions in this package

Example: count capabilities per package:
```bash
curl -s http://localhost:3847/api/packages | \
  jq '.[] | {id, version, enabled, cap_count: (.capabilities | length)}'
```

---

## 2. Register a package via YAML (local repo)

Packages discovered in `capability.yaml` files under the local repo are registered automatically at startup and on reindex. To add a new package:

1. Create the skill directory with `capability.yaml` and entrypoint file(s).
2. Trigger a reindex:

```bash
curl -s -X POST http://localhost:3847/api/packages/reindex | jq .
```

The response lists all indexed packages, orphan directories, and any parse failures.

**No manual registration is needed for local repo packages** — the indexer discovers them from `capability.yaml` files in any subdirectory.

---

## 3. Register a package via archive upload

For skills from other repos or delivered as tarballs:

```bash
curl -s -X POST http://localhost:3847/api/packages/import \
  -F "file=@/path/to/skill-archive.tar.gz" | jq .
```

To overwrite an existing imported package:

```bash
curl -s -X POST http://localhost:3847/api/packages/import \
  -F "file=@/path/to/skill-archive.tar.gz" \
  -F "force=true" | jq .
```

**Supported formats:** `.tar.gz`, `.tgz`, `.zip`, `.md` (single-file skill)

---

## 4. Inspect an archive before import

Preview what a skill archive contains without committing it:

```bash
curl -s -X POST http://localhost:3847/api/packages/import/inspect \
  -F "file=@/path/to/skill-archive.tar.gz" | jq .
```

Check:
- `packageId` — the ID that would be registered
- `capabilities` — list of capabilities that would be created
- `warnings` — any issues with the manifest

---

## 5. Reindex packages from local repo

After adding, editing, or removing a skill in the local repository:

```bash
curl -s -X POST http://localhost:3847/api/packages/reindex | jq .
```

Response includes:
- `artifacts` — successfully indexed packages
- `failures` — directories that failed to parse
- `orphans` — import directories with no matching package definition

---

## 6. Enable a capability within a package

Individual capabilities within a package can be enabled or disabled. To enable:

```bash
# Using the /api/tools endpoint
curl -s -X POST http://localhost:3847/api/tools/skill.my_package.my_tool/enable | jq .

# Using the PUT enabled endpoint
curl -s -X PUT http://localhost:3847/api/tools/skill.my_package.my_tool/enabled \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}' | jq .
```

---

## 7. Disable a capability within a package

```bash
# Using the /api/tools endpoint
curl -s -X POST http://localhost:3847/api/tools/skill.my_package.my_tool/disable | jq .

# Using the PUT enabled endpoint
curl -s -X PUT http://localhost:3847/api/tools/skill.my_package.my_tool/enabled \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}' | jq .
```

To disable all tools in a package at once, iterate over capabilities:

```bash
PKG_ID="skill.my_package"
curl -s http://localhost:3847/api/packages | \
  jq -r --arg id "$PKG_ID" \
    '.[] | select(.id == $id) | .capabilities[].id' | \
  while read -r cap_id; do
    echo "Disabling $cap_id"
    curl -s -X POST "http://localhost:3847/api/tools/${cap_id}/disable" | jq .enabled
  done
```

---

## 8. Rollback: re-upload a previous archive version

To revert an imported skill to a previous version, re-upload the older archive with `force=true`:

```bash
curl -s -X POST http://localhost:3847/api/packages/import \
  -F "file=@/path/to/skill-archive-v1.0.0.tar.gz" \
  -F "force=true" | jq .
```

> **Note:** For local repo packages, rollback means reverting the `capability.yaml` and entrypoint in the repository and running reindex. The registry always reflects the current state of the files on disk.

---

## 9. Delete a package

```bash
curl -s -X DELETE http://localhost:3847/api/packages/skill.my_package | jq .
```

For imported packages, the import directory on disk is also removed automatically.

For local repo packages, deletion from the registry only lasts until the next reindex. To permanently remove a local skill, delete the directory from the repo and reindex.

---

## 10. Orphan cleanup

Orphan import directories are left-over `imports/<packageId>/` directories that have no corresponding package definition in the registry.

List orphans (dry run):
```bash
curl -s -X POST http://localhost:3847/api/packages/cleanup \
  -H "Content-Type: application/json" \
  -d '{}' | jq .orphans
```

Remove orphans:
```bash
curl -s -X POST http://localhost:3847/api/packages/cleanup \
  -H "Content-Type: application/json" \
  -d '{"force": true}' | jq .
```

---

## Quick reference

| Action | Method | Path |
|--------|--------|------|
| List packages | GET | `/api/packages` |
| List + reindex | GET | `/api/packages?refresh=1` |
| Trigger reindex | POST | `/api/packages/reindex` |
| Inspect archive | POST | `/api/packages/import/inspect` |
| Import archive | POST | `/api/packages/import` |
| Delete package | DELETE | `/api/packages/:packageId` |
| Cleanup orphans | POST | `/api/packages/cleanup` |
| Enable capability | POST | `/api/tools/:capId/enable` |
| Disable capability | POST | `/api/tools/:capId/disable` |
| Set enabled state | PUT | `/api/tools/:capId/enabled` |

---

## See also

- [module-runtime-skill.md](./module-runtime-skill.md) — building a new skill from scratch
- [incident-response.md](./incident-response.md) — emergency kill-switch procedures
- [operator-guide.md](../operator-guide.md) — day-to-day operations overview
