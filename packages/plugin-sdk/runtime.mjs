// Runtime companion for plugins loaded by jiti. Keep this file dependency-free
// and plain JavaScript so it can be imported without TypeScript transpilation.
export const MANIFEST_VERSION = 1;
export const PLUGIN_API_VERSION = 1;

export class PluginError extends Error {
  constructor(code, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = "PluginError";
    this.code = code;
    this.retryable =
      options.retryable ??
      (code === "network" || code === "rate_limited" || code === "timeout");
    this.details = options.details;
  }
}

export function isPluginError(error) {
  return (
    error instanceof Error &&
    error.name === "PluginError" &&
    typeof error.code === "string"
  );
}

export function definePlugin(plugin) {
  return plugin;
}
