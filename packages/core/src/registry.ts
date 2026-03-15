/**
 * Host registry - in-memory store of validated host configurations.
 */
import { Effect } from "effect";
import type { HostConfig } from "./schema.js";
import { HostNotFound } from "./errors.js";

/**
 * Immutable registry of host configurations, indexed by name.
 */
export class HostRegistry {
  private readonly hosts: ReadonlyMap<string, HostConfig>;

  constructor(hosts: ReadonlyMap<string, HostConfig>) {
    this.hosts = hosts;
  }

  /**
   * Create a HostRegistry from a plain record of host configs.
   */
  static fromRecord(record: Record<string, HostConfig>): HostRegistry {
    return new HostRegistry(new Map(Object.entries(record)));
  }

  /**
   * Get all hosts as an array of [name, config] tuples.
   */
  getAllHosts(): ReadonlyArray<readonly [string, HostConfig]> {
    return Array.from(this.hosts.entries());
  }

  /**
   * Get a specific host by name.
   * Returns an Effect that fails with HostNotFound if the host doesn't exist.
   */
  getHost(name: string): Effect.Effect<HostConfig, HostNotFound> {
    const config = this.hosts.get(name);
    if (config === undefined) {
      return Effect.fail(new HostNotFound({ name }));
    }
    return Effect.succeed(config);
  }

  /**
   * Check if a host exists in the registry.
   */
  hasHost(name: string): boolean {
    return this.hosts.has(name);
  }

  /**
   * Get the number of hosts in the registry.
   */
  get size(): number {
    return this.hosts.size;
  }
}
