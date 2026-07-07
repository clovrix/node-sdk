import { ClovrixConfigError, ClovrixConnectionError, errorFromResponse } from "./errors.js";
import type {
  ClovrixClientOptions,
  Entry,
  SetEntryOptions,
  WriteItem,
  WriteResult,
} from "./types.js";

const DEFAULT_BASE_URL = "https://app.clovrix.com";
const API_PREFIX = "/api/public/v1";
const DEFAULT_TIMEOUT_MS = 30_000;
const SDK_VERSION = "0.1.0";

interface RawEntry {
  key: string;
  value: string;
  is_secret: boolean;
}

/** A project + environment pair, for the {@link ClovrixClient.scope} helper. */
export interface ScopedClient {
  /** Fetch one entry by key. */
  get(key: string): Promise<Entry>;
  /** Fetch every entry as a `key → value` map. */
  getAll(): Promise<Record<string, string>>;
  /** Write a single entry. */
  set(key: string, value: string, options?: SetEntryOptions): Promise<WriteResult>;
  /** Write up to 100 entries atomically. */
  setMany(items: WriteItem[]): Promise<number>;
}

/**
 * Client for the Clovrix Public API.
 *
 * ```ts
 * const clovrix = new ClovrixClient();              // reads CLOVRIX_TOKEN
 * const all = await clovrix.getEntries("backend", "production");
 * ```
 */
export class ClovrixClient {
  private readonly token: string;
  private readonly apiRoot: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  constructor(options: ClovrixClientOptions = {}) {
    const token = options.token ?? readEnv("CLOVRIX_TOKEN");
    if (!token) {
      throw new ClovrixConfigError(
        "No Clovrix API token provided. Pass { token } or set the CLOVRIX_TOKEN environment variable.",
      );
    }
    this.token = token;

    const base = (options.baseUrl ?? readEnv("CLOVRIX_API_URL") ?? DEFAULT_BASE_URL).replace(
      /\/+$/,
      "",
    );
    this.apiRoot = base.endsWith(API_PREFIX) ? base : base + API_PREFIX;

    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const resolvedFetch = options.fetch ?? globalThis.fetch;
    if (typeof resolvedFetch !== "function") {
      throw new ClovrixConfigError(
        "No fetch implementation available. Use Node 18+ or pass { fetch } explicitly.",
      );
    }
    this.fetchImpl = resolvedFetch;
    this.userAgent = options.userAgent ?? `clovrix-sdk-node/${SDK_VERSION}`;
  }

  /** Fetch a single entry's value. Throws `ClovrixNotFoundError` if the key is unset. */
  async getEntry(project: string, environment: string, key: string): Promise<Entry> {
    const { data } = await this.request<RawEntry>("GET", [
      "projects",
      project,
      "environments",
      environment,
      "entries",
      key,
    ]);
    return toEntry(data);
  }

  /**
   * Fetch every entry for an environment as a `key → value` map. Keys with no
   * value set for this environment are omitted. Secret values are decrypted.
   */
  async getEntries(project: string, environment: string): Promise<Record<string, string>> {
    const { data } = await this.request<{ entries?: Record<string, string> }>("GET", [
      "projects",
      project,
      "environments",
      environment,
      "entries",
    ]);
    return data.entries ?? {};
  }

  /** Write a single entry, creating it if it does not exist. */
  async setEntry(
    project: string,
    environment: string,
    key: string,
    value: string,
    options: SetEntryOptions = {},
  ): Promise<WriteResult> {
    const body: { value: string; is_secret?: boolean } = { value };
    if (options.isSecret !== undefined) {
      body.is_secret = options.isSecret;
    }
    const { data } = await this.request<WriteResult>(
      "POST",
      ["projects", project, "environments", environment, "entries", key],
      body,
    );
    return { key: data.key, created: data.created };
  }

  /**
   * Write up to 100 entries in a single atomic request. One invalid item rejects
   * the whole batch (`ClovrixValidationError`) with nothing written. Returns the
   * number of entries written.
   */
  async setEntries(project: string, environment: string, items: WriteItem[]): Promise<number> {
    const entries = items.map((item) => {
      const out: { key: string; value: string; is_secret?: boolean } = {
        key: item.key,
        value: item.value,
      };
      if (item.isSecret !== undefined) {
        out.is_secret = item.isSecret;
      }
      return out;
    });
    const { data } = await this.request<{ written: number }>(
      "POST",
      ["projects", project, "environments", environment, "entries"],
      { entries },
    );
    return data.written;
  }

  /** Bind a project + environment, returning a small accessor over the four operations. */
  scope(project: string, environment: string): ScopedClient {
    return {
      get: (key) => this.getEntry(project, environment, key),
      getAll: () => this.getEntries(project, environment),
      set: (key, value, options) => this.setEntry(project, environment, key, value, options),
      setMany: (items) => this.setEntries(project, environment, items),
    };
  }

  private buildUrl(segments: string[]): string {
    const path = segments.map(encodeURIComponent).join("/");
    return `${this.apiRoot}/${path}`;
  }

  private async request<T>(
    method: string,
    segments: string[],
    body?: unknown,
  ): Promise<{ status: number; data: T }> {
    const url = this.buildUrl(segments);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
      "User-Agent": this.userAgent,
    };
    let payload: string | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: payload,
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new ClovrixConnectionError(
          `Request to ${url} timed out after ${this.timeoutMs}ms`,
          { cause: err },
        );
      }
      throw new ClovrixConnectionError(`Request to ${url} failed`, { cause: err });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let json: unknown;
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }

    if (!response.ok) {
      throw errorFromResponse(response.status, json, text);
    }
    return { status: response.status, data: json as T };
  }
}

function toEntry(raw: RawEntry): Entry {
  return { key: raw.key, value: raw.value, isSecret: raw.is_secret };
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const value = env?.[name];
  return value && value.length > 0 ? value : undefined;
}
