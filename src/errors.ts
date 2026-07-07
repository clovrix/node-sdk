/** Billing state surfaced on a 402 response. */
export type BillingStatus = "pending_payment" | "restricted" | "active";

export interface ClovrixErrorOptions {
  status?: number;
  billingStatus?: BillingStatus;
  cause?: unknown;
}

/** Base class for every error thrown by the SDK. */
export class ClovrixError extends Error {
  /** HTTP status code, when the error originated from an API response. */
  readonly status?: number;
  /** Billing status from a 402 response (`pending_payment` or `restricted`). */
  readonly billingStatus?: BillingStatus;

  constructor(message: string, options: ClovrixErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.status = options.status;
    this.billingStatus = options.billingStatus;
    // Restore the prototype chain when compiled down to ES5-ish targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when the client is misconfigured (e.g. no token could be resolved). */
export class ClovrixConfigError extends ClovrixError {}

/** Thrown when the request never produced an HTTP response (network, DNS, timeout). */
export class ClovrixConnectionError extends ClovrixError {}

/** Base class for any non-2xx API response. `status` is always present. */
export class ClovrixAPIError extends ClovrixError {
  declare readonly status: number;
}

/** 401 — the token is missing, malformed, or expired. */
export class ClovrixAuthenticationError extends ClovrixAPIError {}

/** 402 — the organization's billing is pending setup or restricted. */
export class ClovrixBillingError extends ClovrixAPIError {}

/** 403 — the token's role lacks the required read/write access. */
export class ClovrixForbiddenError extends ClovrixAPIError {}

/** 404 — the project, environment, or key was not found (or is out of scope). */
export class ClovrixNotFoundError extends ClovrixAPIError {}

/** 400 / 413 / 422 — the request was rejected by validation (nothing was written). */
export class ClovrixValidationError extends ClovrixAPIError {}

/** 5xx — the server failed to process an otherwise valid request. */
export class ClovrixServerError extends ClovrixAPIError {}

interface ErrorBody {
  error?: unknown;
  billing_status?: unknown;
}

/** Maps an HTTP status + parsed body onto the most specific error class. */
export function errorFromResponse(status: number, body: unknown, raw: string): ClovrixAPIError {
  const parsed = (body ?? {}) as ErrorBody;
  const message =
    typeof parsed.error === "string" && parsed.error.length > 0
      ? parsed.error
      : raw || `HTTP ${status}`;
  const billingStatus =
    typeof parsed.billing_status === "string"
      ? (parsed.billing_status as BillingStatus)
      : undefined;
  const options: ClovrixErrorOptions = { status, billingStatus };

  switch (status) {
    case 401:
      return new ClovrixAuthenticationError(message, options);
    case 402:
      return new ClovrixBillingError(message, options);
    case 403:
      return new ClovrixForbiddenError(message, options);
    case 404:
      return new ClovrixNotFoundError(message, options);
    case 400:
    case 413:
    case 422:
      return new ClovrixValidationError(message, options);
    default:
      if (status >= 500) {
        return new ClovrixServerError(message, options);
      }
      return new ClovrixAPIError(message, options);
  }
}
