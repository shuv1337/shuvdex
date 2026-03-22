/**
 * Utilities for reading and writing fleet.yaml from the API server.
 *
 * The config file is always in the format:
 *
 * ```yaml
 * hosts:
 *   shuvbot:
 *     hostname: shuvbot
 *     connectionType: ssh
 *     timeout: 10
 * ```
 *
 * All writes are synchronous to keep the implementation simple.  The API
 * server handles one request at a time for host mutations so concurrent
 * write conflicts are not a concern in the single-process deployment.
 */
import * as fs from "node:fs";
import * as YAML from "yaml";
import type { HostConfig } from "@shuvdex/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal representation of the fleet.yaml document used by the writer.
 */
export interface FleetYamlData {
  hosts: Record<string, HostConfig>;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read fleet.yaml from `filePath` and return the parsed hosts map.
 *
 * Returns `{ hosts: {} }` when the file does not exist or cannot be parsed,
 * so callers always get a usable structure.
 */
export function readFleetYaml(filePath: string): FleetYamlData {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = YAML.parse(content) as Record<string, unknown> | null;
    const hostsRaw =
      parsed != null && typeof parsed === "object" && "hosts" in parsed
        ? (parsed["hosts"] as Record<string, HostConfig>)
        : {};
    return { hosts: hostsRaw ?? {} };
  } catch {
    return { hosts: {} };
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Serialise `data` back to `filePath` as YAML.
 *
 * The parent directory is created if it does not exist.
 */
export function writeFleetYaml(filePath: string, data: FleetYamlData): void {
  // Ensure parent directory exists (handles first-write scenarios)
  const dir = filePath.slice(0, Math.max(0, filePath.lastIndexOf("/")));
  if (dir) fs.mkdirSync(dir, { recursive: true });

  const yaml = YAML.stringify(data, { indent: 2, lineWidth: 0 });
  fs.writeFileSync(filePath, yaml, "utf-8");
}
