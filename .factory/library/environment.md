# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## External Dependencies

- **OTEL Collector:** localhost:4318 (OTLP/HTTP) - part of maple stack
- **SSH Hosts:** shuvtest (Linux), shuvbot (macOS)

## Environment Variables

None required for basic operation. SSH uses standard key-based auth from ~/.ssh/.

## Node.js Version

Requires Node.js 20+ (confirmed: v25.2.1)
