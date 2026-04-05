#!/usr/bin/env node
/**
 * CCUsage aggregate tool — collects AI token usage across coding assistants
 * on the gateway host and returns a unified summary.
 *
 * Input contract (via request.args):
 *   days: number  (default: 30, 0 for all time)
 *   mode: "summary" | "models"  (default: "summary")
 *
 * Output: { period, totalCost, totalInput, totalOutput, sources, models?, durationMs }
 *
 * This is the "summary mode" implementation — it shells out to @ccusage/* CLI
 * tools for each discovered source and aggregates the JSON output.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function fail(message) {
  process.stdout.write(JSON.stringify({
    payload: { error: message, capability: "skill.ccusage.aggregate" },
    isError: true,
  }));
  process.exit(0);
}

/**
 * Try to run a ccusage CLI and parse JSON output.
 * Returns null on any failure (CLI missing, no data, etc).
 */
function trySource(name, cmd, timeout = 15000) {
  try {
    const output = execSync(cmd, {
      timeout,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, TZ: "America/Los_Angeles" },
    });
    // Filter out non-JSON lines (warnings, progress messages)
    const lines = output.split("\n").filter(l => l.startsWith("{") || l.startsWith("["));
    const json = JSON.parse(lines.join("\n") || "null");
    return json;
  } catch {
    return null;
  }
}

function parseDailyEntries(data) {
  if (!data) return [];
  // Handle both { daily: [...] } and [...] shapes
  const daily = Array.isArray(data) ? data : (data.daily ?? []);
  return daily.filter(e => e && typeof e === "object");
}

const raw = await new Promise((resolve, reject) => {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => resolve(input));
  process.stdin.on("error", reject);
});

try {
  const startMs = Date.now();
  const request = JSON.parse(raw || "{}");
  const args = request.args ?? {};

  const days = args.days != null ? Number(args.days) : 30;
  const mode = args.mode ?? "summary";

  if (!["summary", "models"].includes(mode)) {
    fail(`Invalid mode: ${mode}. Use "summary" or "models".`);
  }

  const sinceFlag = days > 0 ? `--since $(date -d '-${days} days' +%Y%m%d 2>/dev/null || date -v-${days}d +%Y%m%d)` : "";
  const period = days > 0 ? `last ${days} days` : "all time";

  // Discover available sources and collect data
  const sources = [];
  const allModels = new Map();
  let totalCost = 0;
  let totalInput = 0;
  let totalOutput = 0;

  // Claude Code / Pi sessions
  const piPath = path.join(os.homedir(), ".clawdbot", "agents", "main", "sessions");
  if (fs.existsSync(piPath)) {
    const data = trySource("claude-code",
      `npx -y @ccusage/pi@latest daily --piPath ${JSON.stringify(piPath)} -z America/Los_Angeles ${sinceFlag} --json`
    );
    if (data) {
      const entries = parseDailyEntries(data);
      let cost = 0, inp = 0, out = 0;
      for (const e of entries) {
        for (const bd of (e.modelBreakdowns ?? [])) {
          cost += bd.cost ?? 0;
          inp += bd.inputTokens ?? 0;
          out += bd.outputTokens ?? 0;
          const name = bd.modelName ?? "unknown";
          const prev = allModels.get(name) ?? { cost: 0, input: 0, output: 0 };
          allModels.set(name, { cost: prev.cost + (bd.cost ?? 0), input: prev.input + (bd.inputTokens ?? 0), output: prev.output + (bd.outputTokens ?? 0) });
        }
      }
      sources.push({ source: "claude-code", cost: round(cost), inputTokens: inp, outputTokens: out });
      totalCost += cost; totalInput += inp; totalOutput += out;
    }
  }

  // OpenCode sessions
  const opencodePath = path.join(os.homedir(), ".opencode", "sessions");
  if (fs.existsSync(opencodePath)) {
    const data = trySource("opencode", `npx -y @ccusage/opencode@latest daily --json`);
    if (data) {
      const entries = parseDailyEntries(data);
      let cost = 0, inp = 0, out = 0;
      for (const e of entries) {
        cost += e.totalCost ?? e.cost ?? 0;
        inp += e.inputTokens ?? 0;
        out += e.outputTokens ?? 0;
      }
      sources.push({ source: "opencode", cost: round(cost), inputTokens: inp, outputTokens: out });
      totalCost += cost; totalInput += inp; totalOutput += out;
      // OpenCode doesn't provide per-model breakdowns in daily mode
      if (cost > 0) {
        const prev = allModels.get("opencode") ?? { cost: 0, input: 0, output: 0 };
        allModels.set("opencode", { cost: prev.cost + cost, input: prev.input + inp, output: prev.output + out });
      }
    }
  }

  // Codex CLI
  const codexPath = path.join(os.homedir(), ".codex");
  if (fs.existsSync(codexPath)) {
    const data = trySource("codex", `npx -y @ccusage/codex@latest daily -z America/Los_Angeles ${sinceFlag} --json`);
    if (data) {
      const entries = parseDailyEntries(data);
      let cost = 0, inp = 0, out = 0;
      for (const e of entries) {
        cost += e.costUSD ?? e.cost ?? 0;
        inp += e.inputTokens ?? 0;
        out += e.outputTokens ?? 0;
      }
      sources.push({ source: "codex", cost: round(cost), inputTokens: inp, outputTokens: out });
      totalCost += cost; totalInput += inp; totalOutput += out;
      if (cost > 0) {
        const prev = allModels.get("codex") ?? { cost: 0, input: 0, output: 0 };
        allModels.set("codex", { cost: prev.cost + cost, input: prev.input + inp, output: prev.output + out });
      }
    }
  }

  const result = {
    period,
    totalCost: round(totalCost),
    totalInput,
    totalOutput,
    sources,
    durationMs: Date.now() - startMs,
    capability: "skill.ccusage.aggregate",
  };

  if (mode === "models") {
    result.models = [...allModels.entries()]
      .map(([model, data]) => ({ model, cost: round(data.cost), inputTokens: data.input, outputTokens: data.output }))
      .sort((a, b) => b.cost - a.cost);
  }

  process.stdout.write(JSON.stringify({ payload: result }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    payload: {
      error: error instanceof Error ? error.message : String(error),
      capability: "skill.ccusage.aggregate",
    },
    isError: true,
  }));
  process.exit(0);
}

function round(n) {
  return Math.round(n * 10000) / 10000;
}
