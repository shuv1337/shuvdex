---
name: upload
description: Upload files to files.shuv.me via the shuvdex MCP gateway. Accepts base64 content or a source URL.
---

# Upload

Upload files to the Latitudes file sharing server at files.shuv.me.

## MCP Tool Contract

Input (JSON):
- `contentBase64` + `filename` — upload raw content encoded as base64
- `sourceUrl` + `filename` — download from a URL and upload

Output (JSON):
- `url` — public URL where the file is served
- `filename` — the filename used
- `bytes` — size in bytes
- `durationMs` — execution time

Files are served at `https://files.shuv.me/<filename>`.

## Notes

- Maximum upload size: 10MB (base64-encoded)
- Use descriptive filenames — they become the public URL path
- Markdown files get rendered with a nice UI
- HTML files are served directly
