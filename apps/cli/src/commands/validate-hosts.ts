/**
 * Host filter validation utility.
 *
 * Validates that host names passed as command-line filters exist in the
 * host registry. Returns an error object listing unknown hosts if any
 * are found, or undefined if all hosts are valid (or no filter is provided).
 */
import { HostRegistry } from "@codex-fleet/core";

/**
 * Error returned when one or more host filters are not found in the registry.
 */
export interface UnknownHostsError {
  readonly unknownHosts: ReadonlyArray<string>;
  readonly availableHosts: ReadonlyArray<string>;
  readonly message: string;
}

/**
 * Validate that all host names in the filter exist in the registry.
 *
 * Returns undefined if no filter is provided, the filter is empty, or all
 * host names are valid. Returns an UnknownHostsError if any host names
 * are not found in the registry.
 *
 * @param registry - The host registry to validate against
 * @param filterHosts - Optional list of host names to validate
 */
export const validateHostFilters = (
  registry: HostRegistry,
  filterHosts: ReadonlyArray<string> | undefined,
): UnknownHostsError | undefined => {
  if (!filterHosts || filterHosts.length === 0) {
    return undefined;
  }

  const unknownHosts = filterHosts.filter((name) => !registry.hasHost(name));

  if (unknownHosts.length === 0) {
    return undefined;
  }

  const availableHosts = registry.getAllHosts().map(([name]) => name);
  const unknownList = unknownHosts.join(", ");
  const availableList = availableHosts.join(", ");

  return {
    unknownHosts,
    availableHosts,
    message: `Unknown host(s): ${unknownList}. Available hosts: ${availableList}`,
  };
};
