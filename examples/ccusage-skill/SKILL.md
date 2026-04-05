---
name: ccusage
description: Aggregate AI token usage and costs across all coding assistants (Claude Code, OpenCode, Codex) on the gateway host.
---

# CCUsage

Unified token usage and cost tracking across AI coding assistants.

## MCP Tool Contract

Input (JSON):
- `days` — number of days to include (default: 30, use 0 for all time)
- `mode` — `"summary"` (totals only) or `"models"` (per-model breakdown)

Output (JSON):
- `period` — description of the time period
- `totalCost` — aggregate cost
- `totalInput` — total input tokens
- `totalOutput` — total output tokens
- `sources` — per-source breakdown (clawdbot, opencode, codex, claude-code)
- `models` — per-model breakdown (when mode=models)
- `durationMs` — execution time

## Notes

- Runs on the gateway host and aggregates data from local session/cost logs
- Sources are discovered automatically based on available log directories
- Summary mode (default) is the fastest and simplest
