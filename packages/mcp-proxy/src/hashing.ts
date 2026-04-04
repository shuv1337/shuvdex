import { createHash } from "node:crypto";
import type { CachedUpstreamTool } from "./types.js";

/**
 * Compute a stable SHA-256 hash of a tool's identity (name + description +
 * input schema).  The hash is used for description-mutation detection and
 * pinning.
 */
export function computeDescriptionHash(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
): string {
  const content = JSON.stringify({ name, description, inputSchema });
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Check whether a tool's current hash matches its pinned hash.
 *
 * - If no `pinnedHash` is set the tool is considered unreviewed; we report
 *   `matched: true` so it doesn't immediately fire a mutation alert.
 * - If `pinnedHash` is set and matches `descriptionHash` → clean.
 * - If `pinnedHash` is set but differs → mutation detected.
 */
export function checkPin(current: CachedUpstreamTool): { matched: boolean; details: string } {
  if (!current.pinnedHash) {
    return { matched: true, details: "not yet pinned – skipping mutation check" };
  }
  const matched = current.descriptionHash === current.pinnedHash;
  return {
    matched,
    details: matched
      ? "hash matches pinned value"
      : `hash mismatch: current=${current.descriptionHash} pinned=${current.pinnedHash}`,
  };
}
