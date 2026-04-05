---
name: model-usage
description: Query per-model AI usage and cost data from CodexBar local cost logs. Supports current model, all models, and summary modes.
---

# Model Usage

Get per-model usage cost summaries from CodexBar's local cost logs on the gateway host.

## MCP Tool Contract

Input (JSON):
- `provider` — `"codex"` or `"claude"` (default: `"codex"`)
- `mode` — `"current"` (most recent model), `"all"` (all models), or `"summary"` (totals only)
- `days` — number of days to include (default: all time)
- `model` — override to query a specific model name

Output (JSON):
- `provider` — which provider was queried
- `mode` — which mode was used
- `models` — array of `{ model, cost }` entries (for current/all modes)
- `totalCost` — total cost across all models
- `durationMs` — execution time

## Notes

- Requires `codexbar` CLI installed on the gateway host
- Data comes from CodexBar's local cost tracking, not provider APIs
