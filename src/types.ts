/** A single configuration/secret entry returned by the API. */
export interface Entry {
  /** The entry key (env-var style, e.g. `DATABASE_URL`). */
  key: string;
  /** The current value for the requested environment. Secrets are decrypted. */
  value: string;
  /** Whether the entry is stored encrypted at rest. */
  isSecret: boolean;
}

/** One key/value pair to write. */
export interface WriteItem {
  key: string;
  value: string;
  /**
   * Marks the entry as a secret. Honoured **only when the key is first created**;
   * it cannot be changed on an existing key.
   */
  isSecret?: boolean;
}

/** The result of writing a single entry. */
export interface WriteResult {
  key: string;
  /** True if a brand-new entry was created; false if a new version was appended. */
  created: boolean;
}

/** Optional flags for {@link ClovrixClient.setEntry}. */
export interface SetEntryOptions {
  isSecret?: boolean;
}

/** Constructor options for {@link ClovrixClient}. */
export interface ClovrixClientOptions {
  /** API token (`clx_…`). Falls back to the `CLOVRIX_TOKEN` environment variable. */
  token?: string;
  /**
   * API host, scheme + host only — the `/api/public/v1` path is added for you.
   * Falls back to `CLOVRIX_API_URL`, then `https://app.clovrix.com`.
   */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** A `fetch` implementation to use instead of the global one (for tests/proxies). */
  fetch?: typeof fetch;
  /** Overrides the default `User-Agent` header. */
  userAgent?: string;
}
