import { afterEach, describe, expect, it } from "vitest";
import {
  ClovrixBillingError,
  ClovrixClient,
  ClovrixConfigError,
  ClovrixNotFoundError,
  ClovrixValidationError,
} from "../src/index.js";

interface Call {
  url: string;
  init: RequestInit;
}

function recorder(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  const fn = (async (url: unknown, init: unknown) => {
    const call: Call = { url: String(url), init: (init ?? {}) as RequestInit };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function headersOf(call: Call): Record<string, string> {
  return call.init.headers as Record<string, string>;
}

const TOKEN = "icr_test_token";

afterEach(() => {
  delete process.env.CLOVRIX_TOKEN;
  delete process.env.CLOVRIX_API_URL;
});

describe("configuration", () => {
  it("throws ClovrixConfigError when no token is available", () => {
    delete process.env.CLOVRIX_TOKEN;
    expect(() => new ClovrixClient({ fetch: recorder(() => json(200, {})).fn })).toThrow(
      ClovrixConfigError,
    );
  });

  it("reads the token from CLOVRIX_TOKEN", async () => {
    process.env.CLOVRIX_TOKEN = TOKEN;
    const { fn, calls } = recorder(() => json(200, { entries: {} }));
    const client = new ClovrixClient({ fetch: fn });
    await client.getEntries("backend", "production");
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("defaults the base URL and appends the API prefix", async () => {
    const { fn, calls } = recorder(() => json(200, { entries: {} }));
    const client = new ClovrixClient({ token: TOKEN, fetch: fn });
    await client.getEntries("backend", "production");
    expect(calls[0].url).toBe(
      "https://app.clovrix.com/api/public/v1/projects/backend/environments/production/entries",
    );
  });

  it("honours a custom base URL without double-appending the prefix", async () => {
    const { fn, calls } = recorder(() => json(200, { entries: {} }));
    const client = new ClovrixClient({
      token: TOKEN,
      baseUrl: "https://app-dev-icarus.wongtawan.dev/api/public/v1/",
      fetch: fn,
    });
    await client.getEntries("backend", "production");
    expect(calls[0].url).toBe(
      "https://app-dev-icarus.wongtawan.dev/api/public/v1/projects/backend/environments/production/entries",
    );
  });

  it("url-encodes path segments", async () => {
    const { fn, calls } = recorder(() => json(200, { key: "A", value: "1", is_secret: false }));
    const client = new ClovrixClient({ token: TOKEN, fetch: fn });
    await client.getEntry("my project", "stg/eu", "A_KEY");
    expect(calls[0].url).toContain("/projects/my%20project/environments/stg%2Feu/entries/A_KEY");
  });
});

describe("reads", () => {
  it("getEntry maps is_secret to isSecret", async () => {
    const { fn } = recorder(() => json(200, { key: "DATABASE_URL", value: "postgres://x", is_secret: true }));
    const client = new ClovrixClient({ token: TOKEN, fetch: fn });
    const entry = await client.getEntry("backend", "production", "DATABASE_URL");
    expect(entry).toEqual({ key: "DATABASE_URL", value: "postgres://x", isSecret: true });
  });

  it("getEntries returns the entries map", async () => {
    const { fn } = recorder(() => json(200, { entries: { A: "1", B: "2" } }));
    const client = new ClovrixClient({ token: TOKEN, fetch: fn });
    const entries = await client.getEntries("backend", "production");
    expect(entries).toEqual({ A: "1", B: "2" });
  });

  it("getEntries tolerates a missing entries field", async () => {
    const { fn } = recorder(() => json(200, {}));
    const client = new ClovrixClient({ token: TOKEN, fetch: fn });
    expect(await client.getEntries("backend", "production")).toEqual({});
  });
});

describe("writes", () => {
  it("setEntry sends value + is_secret and reports created", async () => {
    const { fn, calls } = recorder(() => json(201, { key: "API_KEY", created: true }));
    const client = new ClovrixClient({ token: TOKEN, fetch: fn });
    const result = await client.setEntry("backend", "production", "API_KEY", "secret", {
      isSecret: true,
    });
    expect(result).toEqual({ key: "API_KEY", created: true });
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ value: "secret", is_secret: true });
  });

  it("setEntry omits is_secret when not provided and reports an update", async () => {
    const { fn, calls } = recorder(() => json(200, { key: "API_KEY", created: false }));
    const client = new ClovrixClient({ token: TOKEN, fetch: fn });
    const result = await client.setEntry("backend", "production", "API_KEY", "v2");
    expect(result.created).toBe(false);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ value: "v2" });
  });

  it("setEntries posts an entries array and returns the written count", async () => {
    const { fn, calls } = recorder(() => json(200, { written: 2 }));
    const client = new ClovrixClient({ token: TOKEN, fetch: fn });
    const written = await client.setEntries("backend", "production", [
      { key: "A", value: "1" },
      { key: "B", value: "2", isSecret: true },
    ]);
    expect(written).toBe(2);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      entries: [{ key: "A", value: "1" }, { key: "B", value: "2", is_secret: true }],
    });
  });
});

describe("error mapping", () => {
  it("maps 404 to ClovrixNotFoundError", async () => {
    const { fn } = recorder(() => json(404, { error: "not found" }));
    const client = new ClovrixClient({ token: TOKEN, fetch: fn });
    const err = await client.getEntry("backend", "production", "MISSING").catch((e) => e);
    expect(err).toBeInstanceOf(ClovrixNotFoundError);
    expect(err.status).toBe(404);
    expect(err.message).toBe("not found");
  });

  it("maps 402 to ClovrixBillingError carrying billingStatus", async () => {
    const { fn } = recorder(() => json(402, { error: "billing restricted", billing_status: "restricted" }));
    const client = new ClovrixClient({ token: TOKEN, fetch: fn });
    const err = await client.getEntries("backend", "production").catch((e) => e);
    expect(err).toBeInstanceOf(ClovrixBillingError);
    expect(err.status).toBe(402);
    expect(err.billingStatus).toBe("restricted");
  });

  it("maps 422 to ClovrixValidationError", async () => {
    const { fn } = recorder(() => json(422, { error: "invalid key" }));
    const client = new ClovrixClient({ token: TOKEN, fetch: fn });
    await expect(
      client.setEntries("backend", "production", [{ key: "bad key", value: "x" }]),
    ).rejects.toBeInstanceOf(ClovrixValidationError);
  });
});

describe("scope helper", () => {
  it("binds project and environment", async () => {
    const { fn, calls } = recorder(() => json(200, { entries: { A: "1" } }));
    const client = new ClovrixClient({ token: TOKEN, fetch: fn });
    const scoped = client.scope("backend", "production");
    await scoped.getAll();
    expect(calls[0].url).toContain("/projects/backend/environments/production/entries");
  });
});
