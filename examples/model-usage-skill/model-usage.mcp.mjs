#!/usr/bin/env node
/**
 * Model usage tool — queries CodexBar cost data and returns per-model summaries.
 *
 * Input contract (via request.args):
 *   provider: "codex" | "claude"  (default: "codex")
 *   mode: "current" | "all" | "summary"  (default: "all")
 *   days: number  (optional — filter to last N days)
 *   model: string  (optional — filter to specific model)
 *
 * Output: { provider, mode, models, totalCost, durationMs }
 */
import { execSync } from "node:child_process";

function fail(message) {
  process.stdout.write(JSON.stringify({
    payload: { error: message, capability: "skill.model_usage.query" },
    isError: true,
  }));
  process.exit(0);
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

  const provider = args.provider ?? "codex";
  const mode = args.mode ?? "all";
  const days = args.days != null ? Number(args.days) : null;
  const modelFilter = args.model ?? null;

  if (!["codex", "claude"].includes(provider)) {
    fail(`Invalid provider: ${provider}. Use "codex" or "claude".`);
  }
  if (!["current", "all", "summary"].includes(mode)) {
    fail(`Invalid mode: ${mode}. Use "current", "all", or "summary".`);
  }

  // Fetch cost data from codexbar
  let costJson;
  try {
    const output = execSync(
      `codexbar cost --format json --provider ${provider}`,
      { timeout: 10000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    costJson = JSON.parse(output);
  } catch (err) {
    fail(`Failed to run codexbar: ${err.message}`);
  }

  // Extract the provider payload
  let payload = costJson;
  if (Array.isArray(costJson)) {
    payload = costJson.find(e => e?.provider === provider) ?? costJson[0];
  }
  if (!payload) fail("No cost data returned from codexbar");

  const dailyEntries = Array.isArray(payload.daily) ? payload.daily : [];

  // Date filter
  let filtered = dailyEntries;
  if (days != null && days > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    filtered = dailyEntries.filter(e => (e.date ?? "") >= cutoffStr);
  }

  // Aggregate models
  const modelMap = new Map();
  for (const entry of filtered) {
    const breakdowns = entry.modelBreakdowns ?? [];
    if (breakdowns.length > 0) {
      for (const bd of breakdowns) {
        const name = bd.modelName ?? bd.model ?? "unknown";
        const prev = modelMap.get(name) ?? 0;
        modelMap.set(name, prev + (bd.cost ?? 0));
      }
    } else {
      // Fallback — no per-model breakdown, use entry total
      const modelsUsed = entry.modelsUsed ?? ["unknown"];
      const costPer = (entry.totalCost ?? entry.cost ?? 0) / modelsUsed.length;
      for (const m of modelsUsed) {
        const prev = modelMap.get(m) ?? 0;
        modelMap.set(m, prev + costPer);
      }
    }
  }

  let models = [...modelMap.entries()]
    .map(([model, cost]) => ({ model, cost: Math.round(cost * 10000) / 10000 }))
    .sort((a, b) => b.cost - a.cost);

  // Apply model filter
  if (modelFilter) {
    const lower = modelFilter.toLowerCase();
    models = models.filter(m => m.model.toLowerCase().includes(lower));
  }

  // Mode-specific output
  let result;
  const totalCost = Math.round(models.reduce((s, m) => s + m.cost, 0) * 10000) / 10000;

  if (mode === "current") {
    result = { provider, mode, models: models.slice(0, 1), totalCost: models[0]?.cost ?? 0 };
  } else if (mode === "summary") {
    result = { provider, mode, modelCount: models.length, totalCost };
  } else {
    result = { provider, mode, models, totalCost };
  }

  result.durationMs = Date.now() - startMs;
  result.capability = "skill.model_usage.query";

  process.stdout.write(JSON.stringify({ payload: result }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    payload: {
      error: error instanceof Error ? error.message : String(error),
      capability: "skill.model_usage.query",
    },
    isError: true,
  }));
  process.exit(0);
}
