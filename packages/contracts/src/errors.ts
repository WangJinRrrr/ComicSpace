export type ApiErrorCode =
  | "validation_error"
  | "not_found"
  | "forbidden"
  | "config_required"
  | "auth_required"
  | "rate_limited"
  | "timeout"
  | "cancelled"
  | "network_error"
  | "parse_error"
  | "unsupported"
  | "conflict"
  | "origin_rejected"
  | "internal_error";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    retryable?: boolean;
    details?: unknown;
  };
}

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiErrorInfo {
  status: number;
  code: ApiErrorCode;
  message: string;
  retryable?: boolean;
  details?: unknown;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(info: ApiErrorInfo) {
    super(info.message);
    this.name = "ApiRequestError";
    this.status = info.status;
    this.code = info.code;
    this.retryable = info.retryable ?? false;
    this.details = info.details;
  }
}
