---
name: module-runtime-template
description: Reusable template for packaging a local script as a module_runtime MCP tool.
---

# Module Runtime Skill Template

Use this template when converting an existing local script into a manifest-backed MCP tool.

## Files

- `SKILL.md` — human instructions and discovery metadata
- `capability.yaml` — structured capability manifest
- `package.json` — optional package metadata/versioning
- `echo.mcp.mjs` — executable tool entrypoint that reads JSON from stdin and writes JSON to stdout

## Contract

Your executable should:

1. Read a JSON request from stdin
2. Use `request.args` as the tool arguments
3. Write a single JSON object to stdout
4. Return either:
   - `{ "payload": <json> }`
   - `{ "payload": { "error": "message" }, "isError": true }`

## Notes

- Prefer returning structured errors in JSON instead of throwing
- Keep tool output stable and machine-readable
- Use manifest-relative `executorRef.target` paths such as `./tool.mcp.mjs`
- Add explicit `inputSchema` and `outputSchema` entries in `capability.yaml`
