import { describe, expect, test, afterEach, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCombie } from "../../src/app/init.ts";
import { connectProvider } from "../../src/app/connect.ts";
import { syncProviders } from "../../src/app/sync.ts";
import {
  listProviders,
  listResources,
  formatProvidersTable,
  formatResourcesTable,
} from "../../src/app/list.ts";
import { credentialsPath } from "../../src/storage/paths.ts";

function fixtureEnvelope<T>(result: T) {
  return {
    success: true,
    result,
    errors: [],
    messages: [],
  };
}

function mockCloudflareFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/accounts") || url.includes("/accounts?")) {
      return Response.json(
        fixtureEnvelope([{ id: "acc_test", name: "Test Account" }]),
      );
    }
    if (url.includes("/workers/scripts")) {
      return Response.json(
        fixtureEnvelope([
          { id: "api", created_on: "2024-01-01T00:00:00Z" },
          { id: "webhooks", created_on: "2024-01-02T00:00:00Z" },
        ]),
      );
    }
    if (url.includes("/d1/database")) {
      return Response.json(
        fixtureEnvelope([
          { uuid: "d1-1", name: "production", version: "production" },
        ]),
      );
    }
    if (url.includes("/storage/kv/namespaces")) {
      return Response.json(
        fixtureEnvelope([
          { id: "kv-1", title: "sessions" },
          { id: "kv-2", title: "cache" },
        ]),
      );
    }
    if (url.includes("/zones")) {
      return Response.json(
        fixtureEnvelope([
          { id: "zone-1", name: "example.com", status: "active" },
        ]),
      );
    }
    return Response.json(
      { success: false, errors: [{ code: 7000, message: `unexpected ${url}` }] },
      { status: 404 },
    );
  }) as typeof fetch;
}

describe("app vertical slice", () => {
  let dir: string;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "combie-flow-"));
    originalFetch = globalThis.fetch;
    globalThis.fetch = mockCloudflareFetch();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  });

  test("init → connect → sync → providers → resources (no duplicates)", async () => {
    const init = initCombie(dir);
    expect(init.created).toBe(true);

    const secret = "test-token-must-not-leak";
    const connected = await connectProvider({
      baseDir: dir,
      providerId: "cloudflare",
      token: secret,
    });
    expect(connected.message).toContain("Connected");
    expect(connected.message).toContain("Next:");
    expect(connected.message).toContain("sync");
    expect(connected.message).not.toContain(secret);
    expect(connected.accountId).toBe("acc_test");

    // Credentials file exists and is separate from domain messaging
    expect(existsSync(credentialsPath(dir))).toBe(true);
    const credRaw = readFileSync(credentialsPath(dir), "utf8");
    expect(credRaw).toContain(secret);

    const sync1 = await syncProviders({ baseDir: dir });
    expect(sync1.ok).toBe(true);
    expect(sync1.results[0]!.total).toBe(6);
    expect(sync1.message).toContain("Worker");
    expect(sync1.message).toContain("database");
    expect(sync1.message).toContain("KV");
    expect(sync1.message).toContain("zone");
    expect(sync1.message).toContain("Next:");
    expect(sync1.message).toContain("resources");
    expect(sync1.message).not.toContain(secret);

    const sync2 = await syncProviders({ baseDir: dir });
    expect(sync2.ok).toBe(true);
    expect(sync2.results[0]!.total).toBe(6);

    const { resources } = listResources({ baseDir: dir });
    expect(resources).toHaveLength(6);
    // stable ids, no duplicates after second sync
    const ids = new Set(resources.map((r) => r.id));
    expect(ids.size).toBe(6);

    const { providers } = listProviders(dir);
    expect(providers).toHaveLength(1);
    expect(providers[0]!.status).toBe("connected");
    expect(providers[0]!.lastSyncAt).toBeTruthy();

    const pTable = formatProvidersTable(providers);
    expect(pTable).toContain("Cloudflare");
    expect(pTable).toContain("ACCOUNT");
    expect(pTable).toContain("Test Account");
    expect(pTable).toContain("Connected");
    expect(pTable).not.toContain(secret);

    const rTable = formatResourcesTable(resources);
    expect(rTable).toContain("worker");
    expect(rTable).toContain("api");
    expect(rTable).toContain("database");
    expect(rTable).toContain("kv_namespace");
    expect(rTable).toContain("zone");
    expect(rTable).toContain("example.com");
    expect(rTable).not.toContain(secret);
    for (const resource of resources) {
      expect(rTable).toContain(resource.id);
    }
  });

  test("connect via --use-env path", async () => {
    initCombie(dir);
    const result = await connectProvider({
      baseDir: dir,
      providerId: "cloudflare",
      useEnvToken: true,
      env: { CLOUDFLARE_API_TOKEN: "env-token-value" } as NodeJS.ProcessEnv,
    });
    expect(result.provider).toBe("Cloudflare");
  });
});
