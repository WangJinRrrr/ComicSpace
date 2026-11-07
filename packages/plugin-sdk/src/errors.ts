export type PluginErrorCode =
  | "network"
  | "not_found"
  | "auth_required"
  | "rate_limited"
  | "parse_error"
  | "unsupported"
  | "cancelled"
  | "timeout"
  | "config_required"
  | "unknown";

export interface PluginErrorOptions {
  retryable?: boolean;
  details?: unknown;
  cause?: unknown;
}

export class PluginError extends Error {
  readonly code: PluginErrorCode;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(
    code: PluginErrorCode,
    message: string,
    options: PluginErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "PluginError";
    this.code = code;
    this.retryable =
      options.retryable ??
      (code === "network" || code === "rate_limited" || code === "timeout");
    this.details = options.details;
  }
}

/**
 * Name/shape based on purpose: the SDK can be packaged twice (server bundle and
 * jiti-loaded plugin), so instanceof is not reliable.
 */
export function isPluginError(error: unknown): error is PluginError {
  return (
    error instanceof Error &&
    error.name === "PluginError" &&
    typeof (error as { code?: unknown }).code === "string"
  );
}
