# Runbook: Module Runtime Skills

A module runtime skill packages a local script as an MCP tool. The script is invoked as a child process; it reads a JSON request from stdin and writes a JSON response to stdout. No network server is needed — the MCP server handles the invocation lifecycle.

This runbook covers the full path from creating a new skill to registering it and troubleshooting failures.

---

## Contents

1. [Create a skill from the template](#1-create-a-skill-from-the-template)
2. [SKILL.md frontmatter reference](#2-skillmd-frontmatter-reference)
3. [capability.yaml reference](#3-capabilityyaml-reference)
4. [Writing the entrypoint module](#4-writing-the-entrypoint-module)
5. [Testing a skill locally](#5-testing-a-skill-locally)
6. [Registering the skill (local repo)](#6-registering-the-skill-local-repo)
7. [Registering the skill (archive import)](#7-registering-the-skill-archive-import)
8. [Verifying the skill via MCP](#8-verifying-the-skill-via-mcp)
9. [Troubleshooting execution failures](#9-troubleshooting-execution-failures)

---

## 1. Create a skill from the template

Copy the reference template to a new directory:

```bash
cp -r examples/module-runtime-skill-template skills/my-new-skill
cd skills/my-new-skill
```

The template contains:
- `SKILL.md` — human-readable description with discovery frontmatter
- `capability.yaml` — structured capability manifest
- `package.json` — optional version metadata
- `echo.mcp.mjs` — example entrypoint (replace with your implementation)

Rename or replace `echo.mcp.mjs` with your tool's entrypoint file:

```bash
mv echo.mcp.mjs my-tool.mcp.mjs
```

---

## 2. SKILL.md frontmatter reference

`SKILL.md` is the human-readable documentation for the skill. The YAML frontmatter block is used for discovery and indexing.

```markdown
---
name: my-new-skill
description: One-sentence description of what this skill does.
---

# My New Skill

Longer prose description here. Include:
- What the skill does
- When to use it
- Any prerequisites or dependencies
- Input/output examples

## Files

- `SKILL.md` — this file
- `capability.yaml` — capability manifest
- `my-tool.mcp.mjs` — tool entrypoint

## Notes

Any important caveats or known limitations.
```

**Required frontmatter fields:**
- `name` — kebab-case identifier matching the directory name
- `description` — shown in discovery endpoints and search

---

## 3. capability.yaml reference

`capability.yaml` is the structured manifest that the indexer uses to register the skill with the capability registry.

```yaml
# Top-level package identity
id: skill.my_new_skill            # Prefix "skill." + snake_case name
version: 1.0.0                    # Semver
title: My New Skill               # Human-readable title
description: >
  One-sentence description.
tags:
  - my-domain
  - tool
visibility: public                # public | scoped | private
subjectScopes:
  - skill:read
  - skill:apply

capabilities:
  - id: skill.my_new_skill.my_tool   # Must start with package id + "."
    kind: tool                        # tool | resource | prompt
    title: My Tool
    description: >
      What this tool does. Used in the MCP tool list shown to AI clients.
      Be specific — the AI reads this to decide when to call this tool.
    riskLevel: low                    # low | medium | high
    enabled: true
    visibility: public
    tags:
      - my-domain
    executorRef:
      executorType: module_runtime
      target: ./my-tool.mcp.mjs      # Relative path from capability.yaml
      timeoutMs: 30000               # Per-invocation timeout (ms)
    tool:
      sideEffectLevel: read          # read | write
      timeoutMs: 30000
      inputSchema:
        type: object
        properties:
          param1:
            type: string
            description: First parameter description.
          param2:
            type: integer
            description: Optional second parameter.
        required:
          - param1
      outputSchema:
        type: object
        properties:
          result:
            type: string
```

**Key fields:**

| Field | Required | Notes |
|-------|----------|-------|
| `id` | Yes | Globally unique. Convention: `skill.<snake_case_name>.<tool_name>` |
| `kind` | Yes | `tool` for MCP tools |
| `riskLevel` | Yes | Affects policy evaluation. Use `low` for read-only, `high` for destructive |
| `executorRef.target` | Yes | Path relative to `capability.yaml` directory |
| `executorRef.timeoutMs` | No | Default: 30000. Increase for slow operations |
| `sideEffectLevel` | Yes | `read` or `write`. Write tools need explicit policy approval |
| `inputSchema` | Yes | JSON Schema. Validated before invocation |
| `outputSchema` | Recommended | Used for documentation and future validation |

---

## 4. Writing the entrypoint module

The entrypoint is a Node.js ESM module (`*.mjs`) that:

1. Reads a JSON request from stdin
2. Processes `request.args` as the tool arguments
3. Writes a single JSON object to stdout
4. Exits with code 0 (even on handled errors)

### Minimal template

```javascript
#!/usr/bin/env node
// my-tool.mcp.mjs

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}

const request = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
const args = request.args ?? {};

try {
  // --- your implementation ---
  const result = await doSomething(args.param1);
  // --- end implementation ---

  process.stdout.write(JSON.stringify({ payload: result }) + "\n");
} catch (err) {
  process.stdout.write(
    JSON.stringify({
      payload: { error: err.message || String(err) },
      isError: true,
    }) + "\n"
  );
}
```

### Success response

```json
{ "payload": { "key": "value" } }
```

### Error response

Return this instead of throwing — the MCP server maps it to `isError: true` in the tool call response:

```json
{ "payload": { "error": "Something went wrong" }, "isError": true }
```

### Request envelope

The full request object passed via stdin:

```json
{
  "args": {
    "param1": "value",
    "param2": 42
  }
}
```

---

## 5. Testing a skill locally

### Unit test: call the entrypoint directly

```bash
echo '{"args": {"param1": "hello"}}' | node my-tool.mcp.mjs
```

Expected output:
```json
{"payload": {"result": "processed: hello"}}
```

### Check the schema is valid YAML

```bash
npx js-yaml capability.yaml
# or
python3 -c "import yaml; yaml.safe_load(open('capability.yaml'))"
```

### Inspect what the indexer sees

```bash
curl -s -X POST http://localhost:3847/api/packages/reindex | \
  jq '.artifacts[] | select(.skillName == "my-new-skill")'
```

---

## 6. Registering the skill (local repo)

If the skill lives in the shuvdex repository or in a path the server has access to via `LOCAL_REPO_PATH`:

1. Place the skill directory under the repo root (e.g. `skills/my-new-skill/`).
2. Trigger a reindex:

```bash
curl -s -X POST http://localhost:3847/api/packages/reindex | jq .
```

3. Verify the package appeared:

```bash
curl -s http://localhost:3847/api/packages | \
  jq '.[] | select(.id == "skill.my_new_skill")'
```

4. Verify the tool is surfaced in the MCP tool list:

```bash
curl -s http://localhost:3847/api/tools | \
  jq '.[] | select(.id | startswith("skill.my_new_skill"))'
```

---

## 7. Registering the skill (archive import)

For skills from external repos, package the directory as a tarball and import it:

```bash
# Create the archive (from inside the skill directory)
cd skills/my-new-skill
tar -czf /tmp/my-new-skill.tar.gz .

# Import via API
curl -s -X POST http://localhost:3847/api/packages/import \
  -F "file=@/tmp/my-new-skill.tar.gz" | jq .
```

To update an existing import:
```bash
curl -s -X POST http://localhost:3847/api/packages/import \
  -F "file=@/tmp/my-new-skill.tar.gz" \
  -F "force=true" | jq .
```

---

## 8. Verifying the skill via MCP

Use the direct MCP protocol to confirm the skill is working end-to-end:

```bash
MCP_URL="http://localhost:3848/mcp"

# List tools — should show your new tool
curl -s "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | \
  jq '.result.tools[] | select(.name | startswith("skill.my_new_skill"))'

# Call the tool
curl -s "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "skill.my_new_skill.my_tool",
      "arguments": {"param1": "hello"}
    }
  }' | jq .
```

A successful result:
```json
{
  "result": {
    "content": [{"type": "text", "text": "{\"result\":\"processed: hello\"}"}],
    "isError": false
  }
}
```

An error result:
```json
{
  "result": {
    "content": [{"type": "text", "text": "{\"error\":\"Something went wrong\"}"}],
    "isError": true
  }
}
```

---

## 9. Troubleshooting execution failures

### Tool not appearing in MCP tools/list

1. Check the package was indexed:
   ```bash
   curl -s http://localhost:3847/api/packages | \
     jq '.[] | select(.id == "skill.my_new_skill")'
   ```
   If absent → reindex: `curl -s -X POST http://localhost:3847/api/packages/reindex`

2. Check the capability is enabled:
   ```bash
   curl -s http://localhost:3847/api/tools | \
     jq '.[] | select(.id | startswith("skill.my_new_skill")) | {id, enabled}'
   ```
   If `enabled: false` → `curl -s -X POST http://localhost:3847/api/tools/skill.my_new_skill.my_tool/enable`

3. Check for parse errors:
   ```bash
   curl -s -X POST http://localhost:3847/api/packages/reindex | jq .failures
   ```

### Tool call returns `isError: true` with "execution failed"

1. Test the entrypoint directly:
   ```bash
   echo '{"args": {"param1": "test"}}' | node skills/my-new-skill/my-tool.mcp.mjs
   ```

2. Check the `target` path in `capability.yaml` is correct and relative to the manifest.

3. Check file permissions:
   ```bash
   ls -la skills/my-new-skill/my-tool.mcp.mjs
   ```

4. Look for unhandled exceptions — the entrypoint should catch all errors and return `{"payload": {"error": "..."}, "isError": true}` rather than crashing.

### Tool call times out

Increase `executorRef.timeoutMs` in `capability.yaml`:
```yaml
executorRef:
  executorType: module_runtime
  target: ./my-tool.mcp.mjs
  timeoutMs: 60000   # increase from 30000 to 60000
```

Then reindex:
```bash
curl -s -X POST http://localhost:3847/api/packages/reindex | jq .
```

### "capability not found" or wrong tool name

Check your `capability.yaml` IDs are consistent:
- Package `id`: `skill.my_new_skill`
- Capability `id`: `skill.my_new_skill.my_tool`
- Capability `id` must start with the package `id` + `.`

---

## Checklist: new skill ready to register

- [ ] `SKILL.md` has valid YAML frontmatter with `name` and `description`
- [ ] `capability.yaml` has unique package `id` and capability `id`
- [ ] `executorRef.target` is a relative path to an existing file
- [ ] Entrypoint reads from stdin, writes JSON to stdout, exits 0
- [ ] `inputSchema` lists all required fields with types
- [ ] `riskLevel` reflects actual risk (`low` for read-only)
- [ ] `sideEffectLevel` is `write` if the tool modifies anything
- [ ] Local test passes: `echo '{"args":{...}}' | node my-tool.mcp.mjs`
- [ ] Reindex shows the skill without failures
- [ ] MCP `tools/call` returns non-error result

---

## See also

- `examples/module-runtime-skill-template/` — reference implementation
- [package-lifecycle.md](./package-lifecycle.md) — managing packages after registration
- [incident-response.md](./incident-response.md) — disabling a skill in an emergency
- [operator-guide.md](../operator-guide.md) — day-to-day operations overview
