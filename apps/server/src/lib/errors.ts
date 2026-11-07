import type { ApiErrorCode } from "@comicspace/contracts";
import { isPluginError } from "@comicspace/plugin-sdk";

export interface AppErrorOptions {
  retryable?: boolean;
  details?: unknown;
  cause?: unknown;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    options: AppErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError(400, "validation_error", message, { details });
}

export function notFound(message = "Not found"): AppError {
  return new AppError(404, "not_found", message);
}

export function conflict(message: string): AppError {
  return new AppError(409, "conflict", message);
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (isPluginError(error)) {
    switch (error.code) {
      case "not_found":
        return new AppError(404, "not_found", error.message, {
          retryable: error.retryable,
          details: error.details,
        });
      case "auth_required":
        return new AppError(409, "auth_required", error.message, {
          retryable: false,
          details: error.details,
        });
      case "config_required":
        return new AppError(409, "config_required", error.message, {
          retryable: false,
          details: error.details,
        });
      case "rate_limited":
        return new AppError(429, "rate_limited", error.message, {
          retryable: true,
          details: error.details,
        });
      case "timeout":
        return new AppError(504, "timeout", error.message, {
          retryable: true,
          details: error.details,
        });
      case "cancelled":
        return new AppError(499, "cancelled", error.message, {
          retryable: false,
          details: error.details,
        });
      case "unsupported":
        return new AppError(501, "unsupported", error.message, {
          retryable: false,
          details: error.details,
        });
      case "network":
        return new AppError(502, "network_error", error.message, {
          retryable: true,
          details: error.details,
        });
      case "parse_error":
        return new AppError(502, "parse_error", error.message, {
          retryable: false,
          details: error.details,
        });
      default:
        return new AppError(502, "internal_error", error.message, {
          retryable: error.retryable,
          details: error.details,
        });
    }
  }

  if (error instanceof Error) {
    return new AppError(500, "internal_error", error.message, { cause: error });
  }

  return new AppError(500, "internal_error", "Unexpected server error");
}
