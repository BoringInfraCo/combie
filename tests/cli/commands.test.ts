import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { main } from "../../src/cli/index.ts";
import { formatRelationshipsTable, formatResourcesTable } from "../../src/app/list.ts";
import { createRelationship } from "../../src/domain/relationship.ts";
import { createResource } from "../../src/domain/resource.ts";
import { dbPath } from "../../src/storage/paths.ts";
import { Store } from "../../src/storage/store.ts";
import type { ResourceLabel } from "../../src/app/list.ts";

function capture(fn: () => Promise<number>): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const logs: string[] = [];
  const errs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errs.push(args.map(String).join(" "));
  };
  return fn()
    .then((code) => ({
      code,
      stdout: logs.join("\n"),
      stderr: errs.join("\n"),
    }))
    .finally(() => {
      console.log = origLog;
      console.error = origErr;
    });
}

describe("CLI commands", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "combie-cli-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("init creates local state", async () => {
    const result = await capture(() => main(["init", "--dir", dir]));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Initialized");
    expect(result.stdout).toContain("Next:");
    expect(result.stdout).toContain("connect github --use-gh");
  });

  test("--dir requires an explicit path", async () => {
    const result = await capture(() => main(["init", "--dir"]));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--dir requires a path");
  });

  test("version reports the beta package identity", async () => {
    const long = await capture(() => main(["--version"]));
    expect(long.code).toBe(0);
    expect(long.stdout).toBe("combie 0.6.1");

    const command = await capture(() => main(["version"]));
    expect(command.code).toBe(0);
    expect(command.stdout).toBe("combie 0.6.1");
  });

  test("init is idempotent", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const result = await capture(() => main(["init", "--dir", dir]));
    expect(result.code).toBe(0);
    expect(result.stdout.toLowerCase()).toMatch(/already initialized|initialized/);
    expect(result.stdout).toContain("Next:");
    expect(result.stdout).toContain("connect github --use-gh");
  });

  test("providers fails when not initialized", async () => {
    const result = await capture(() => main(["providers", "--dir", dir]));
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("combie init");
  });

  test("resources fails when not initialized", async () => {
    const result = await capture(() => main(["resources", "--dir", dir]));
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("combie init");
  });

  test("sync fails when not initialized", async () => {
    const result = await capture(() => main(["sync", "--dir", dir]));
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("combie init");
  });

  test("connect fails when not initialized", async () => {
    const result = await capture(() =>
      main(["connect", "cloudflare", "--token", "x", "--dir", dir]),
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("combie init");
  });

  test("connect without a provider lists every supported id", async () => {
    const result = await capture(() => main(["connect"]));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Usage:");
    expect(result.stderr).toContain("Providers:");
    expect(result.stderr).toContain("cloudflare");
    expect(result.stderr).toContain("github");
    expect(result.stderr).toContain("vercel");
    expect(result.stderr).toContain("sentry");
    expect(result.stderr).toContain("neon");
    expect(result.stderr).toContain("planetscale");
    expect(result.stderr).toContain("connect github --use-gh");
  });

  test("connect rejects unknown provider", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const result = await capture(() =>
      main(["connect", "not-a-provider", "--dir", dir]),
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain("unknown");
  });

  test("connect github without auth option fails with guidance", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const result = await capture(() =>
      main(["connect", "github", "--dir", dir]),
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr.toLowerCase()).toMatch(/token|use-gh|use-env/);
  });

  test("help --all prints usage including github", async () => {
    const result = await capture(() => main(["help", "--all"]));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("combie init");
    expect(result.stdout).toContain("connect");
    expect(result.stdout).toContain("github");
    expect(result.stdout).toContain("--use-gh");
    expect(result.stdout).toContain("vercel");
    expect(result.stdout).toContain("VERCEL_TOKEN");
    expect(result.stdout).toContain("sentry");
    expect(result.stdout).toContain("SENTRY_AUTH_TOKEN");
    expect(result.stdout).toContain("SENTRY_TOKEN");
    expect(result.stdout).toContain("neon");
    expect(result.stdout).toContain("NEON_API_KEY");
    expect(result.stdout).toContain("planetscale");
    expect(result.stdout).toContain("PLANETSCALE_SERVICE_TOKEN_ID");
    expect(result.stdout).toContain("PLANETSCALE_SERVICE_TOKEN");
    expect(result.stdout).toContain("--organization");
    expect(result.stdout).toContain("--token-id");
    expect(result.stdout).toContain("relationships");
    expect(result.stdout).toContain("history");
    expect(result.stdout).toContain("context");
    expect(result.stdout).toContain("investigate");
  });

  test("help --all keeps LAST SYNC meaning and lists the attempt clock", async () => {
    const result = await capture(() => main(["help", "--all"]));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("LAST SYNC is last successful sync");
    expect(result.stdout).toContain("LAST ATTEMPT");
  });

  test("help --all documents only the earned shell-native JSON flag", async () => {
    const result = await capture(() => main(["help", "--all"]));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("--json");
    expect(result.stdout).not.toContain("--limit");
    expect(result.stdout).not.toContain("--offline");
    expect(result.stdout).not.toContain("--refresh");
  });

  test("incident --investigation twice still does not group snapshots as members", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const result = await capture(() =>
      main([
        "incident",
        "--investigation",
        "inv:a",
        "--investigation",
        "inv:b",
        "--dir",
        dir,
      ]),
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--investigation takes one exact id");
    expect(result.stdout).not.toContain("Recorded incident");
  });

  test("connect planetscale without auth option fails with guidance", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const result = await capture(() =>
      main(["connect", "planetscale", "--dir", dir]),
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr.toLowerCase()).toMatch(
      /token|use-env|planetscale|service/,
    );
  });

  test("connect vercel without auth option fails with guidance", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const result = await capture(() =>
      main(["connect", "vercel", "--dir", dir]),
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr.toLowerCase()).toMatch(/token|use-env/);
  });

  test("connect sentry without auth option fails with guidance", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const result = await capture(() =>
      main(["connect", "sentry", "--dir", dir]),
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr.toLowerCase()).toMatch(/token|use-env/);
  });

  test("providers and resources empty states after init", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const providers = await capture(() => main(["providers", "--dir", dir]));
    expect(providers.code).toBe(0);
    expect(providers.stdout.toLowerCase()).toMatch(/no providers|connect/);
    for (const providerId of [
      "cloudflare",
      "github",
      "vercel",
      "sentry",
      "neon",
      "planetscale",
    ]) {
      expect(providers.stdout).toContain(providerId);
    }

    const resources = await capture(() => main(["resources", "--dir", dir]));
    expect(resources.code).toBe(0);
    expect(resources.stdout.toLowerCase()).toMatch(/no resources|sync/);
  });

  test("sync empty state enumerates every supported provider", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const result = await capture(() => main(["sync", "--dir", dir]));
    expect(result.code).not.toBe(0);
    for (const providerId of [
      "cloudflare",
      "github",
      "vercel",
      "sentry",
      "neon",
      "planetscale",
    ]) {
      expect(result.stderr).toContain(providerId);
    }
  });

  test("relationships fails when not initialized", async () => {
    const result = await capture(() => main(["relationships", "--dir", dir]));
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("combie init");
  });

  test("changes fails when not initialized", async () => {
    const result = await capture(() => main(["changes", "--dir", dir]));
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("combie init");
  });

  test("changes has an offline empty state and renders persisted Changes", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const empty = await capture(() => main(["changes", "--dir", dir]));
    expect(empty.code).toBe(0);
    expect(empty.stdout).toContain("No changes observed yet");

    const store = new Store(dir);
    store.isInitialized();
    const resource = createResource({
      provider: "vercel",
      providerResourceId: "prj_change",
      kind: "project",
      name: "before",
      metadata: { region: "iad1" },
    });
    store.applyResource(resource, {
      id: "initial",
      observedAt: "2026-08-08T10:00:00.000Z",
    });
    store.applyResource(
      { ...resource, name: "after", metadata: { region: "sfo1" } },
      { id: "rename", observedAt: "2026-08-08T11:00:00.000Z" },
    );
    const second = createResource({
      provider: "github",
      providerResourceId: "repo_change",
      kind: "repository",
      name: "repo-before",
      metadata: {},
    });
    store.applyResource(second, {
      id: "second-initial",
      observedAt: "2026-08-08T11:30:00.000Z",
    });
    store.applyResource(
      { ...second, name: "repo-after" },
      { id: "second-rename", observedAt: "2026-08-08T12:00:00.000Z" },
    );
    store.close();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("changes must not call a provider");
    }) as unknown as typeof fetch;
    try {
      const result = await capture(() => main(["changes", "--dir", dir]));
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("RESOURCE");
      expect(result.stdout).toContain("vercel:project:prj_change");
      expect(result.stdout).toContain("github:repository:repo_change");
      expect(result.stdout).toContain("updated");
      expect(result.stdout).toContain("metadata.region, name");
      expect(result.stdout.match(/updated/g)).toHaveLength(2);
      expect(result.stdout.indexOf("github:repository:repo_change")).toBeLessThan(
        result.stdout.indexOf("vercel:project:prj_change"),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("history requires initialization and an exact Resource id", async () => {
    const uninitialized = await capture(() =>
      main(["history", "github:repository:1", "--dir", dir]),
    );
    expect(uninitialized.code).not.toBe(0);
    expect(uninitialized.stderr).toContain("combie init");

    await capture(() => main(["init", "--dir", dir]));
    const missingArgument = await capture(() =>
      main(["history", "--dir", dir]),
    );
    expect(missingArgument.code).not.toBe(0);
    expect(missingArgument.stderr).toContain("Usage: bun run combie history <resource-id>");

    const unknown = await capture(() =>
      main(["history", "github:repository:missing", "--dir", dir]),
    );
    expect(unknown.code).not.toBe(0);
    expect(unknown.stderr).toContain("Resource not found");
    expect(unknown.stderr).toContain("combie resources");
  });

  test("history renders the current Resource and trustworthy zero state", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.isInitialized();
    const resource = createResource({
      provider: "cloudflare",
      providerResourceId: "zone-history",
      kind: "zone",
      name: "example.com",
      metadata: {},
    });
    store.applyResource(resource, {
      id: "initial",
      observedAt: "2026-08-08T09:00:00.000Z",
    });
    store.close();

    const result = await capture(() =>
      main(["history", resource.id, "--dir", dir]),
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Cloudflare zone: example.com");
    expect(result.stdout).toContain(resource.id);
    expect(result.stdout).toContain("CURRENT");
    expect(result.stdout).toContain("No changes recorded yet.");
    expect(result.stdout).toContain("trustworthy Change baseline");
  });

  test("history is offline, scoped, grouped, ordered, and read-only", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.isInitialized();
    const resource = createResource({
      provider: "vercel",
      providerResourceId: "prj_history",
      kind: "project",
      name: "before",
      metadata: { framework: "nextjs", regions: ["iad1"] },
    });
    const other = createResource({
      provider: "github",
      providerResourceId: "repo-history",
      kind: "repository",
      name: "other",
      metadata: {},
    });
    store.applyResource(resource, {
      id: "initial",
      observedAt: "2026-08-08T08:00:00.000Z",
    });
    store.applyResource(other, {
      id: "other-initial",
      observedAt: "2026-08-08T08:00:00.000Z",
    });
    store.applyResource(
      { ...resource, name: "middle", metadata: { regions: ["iad1", "sfo1"] } },
      { id: "older", observedAt: "2026-08-08T09:00:00.000Z" },
    );
    store.applyResource(
      { ...resource, name: "current", metadata: { regions: ["sfo1"] } },
      { id: "newer", observedAt: "2026-08-08T10:00:00.000Z" },
    );
    store.applyResource(
      { ...other, name: "other-new" },
      { id: "other-change", observedAt: "2026-08-08T11:00:00.000Z" },
    );
    const resourcesBefore = store.listResources();
    const changesBefore = store.listChanges();
    const relationshipsBefore = store.listRelationships();
    store.close();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("history must not call a provider");
    }) as unknown as typeof fetch;
    try {
      const result = await capture(() =>
        main(["history", resource.id, "--dir", dir]),
      );
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("name  \"current\"");
      expect(result.stdout.match(/Observed:/g)).toHaveLength(2);
      expect(result.stdout.indexOf("2026-08-08T10:00:00.000Z")).toBeLessThan(
        result.stdout.indexOf("2026-08-08T09:00:00.000Z"),
      );
      expect(result.stdout).toContain('"nextjs" → (absent)');
      expect(result.stdout).toContain('["iad1"] → ["iad1","sfo1"]');
      expect(result.stdout).not.toContain("other-change");

      const globalFeed = await capture(() => main(["changes", "--dir", dir]));
      expect(globalFeed.code).toBe(0);
      expect(globalFeed.stdout.match(/updated/g)).toHaveLength(3);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const reopened = new Store(dir);
    reopened.isInitialized();
    expect(reopened.listResources()).toEqual(resourcesBefore);
    expect(reopened.listChanges()).toEqual(changesBefore);
    expect(reopened.listRelationships()).toEqual(relationshipsBefore);
    reopened.close();
  });

  test("context requires initialization and an exact Resource id", async () => {
    const uninitialized = await capture(() =>
      main(["context", "github:repository:1", "--dir", dir]),
    );
    expect(uninitialized.code).not.toBe(0);
    expect(uninitialized.stderr).toContain("combie init");

    await capture(() => main(["init", "--dir", dir]));
    const missingArgument = await capture(() =>
      main(["context", "--dir", dir]),
    );
    expect(missingArgument.code).not.toBe(0);
    expect(missingArgument.stderr).toContain(
      "Usage: bun run combie context <resource-id>",
    );

    const unknown = await capture(() =>
      main(["context", "github:repository:missing", "--dir", dir]),
    );
    expect(unknown.code).not.toBe(0);
    expect(unknown.stderr).toContain("Resource not found");
    expect(unknown.stderr).toContain("combie resources");
  });

  test("investigate requires initialization and an exact Resource id", async () => {
    const uninitialized = await capture(() =>
      main(["investigate", "vercel:project:1", "--dir", dir]),
    );
    expect(uninitialized.code).not.toBe(0);
    expect(uninitialized.stderr).toContain("combie init");

    await capture(() => main(["init", "--dir", dir]));
    const missingArgument = await capture(() =>
      main(["investigate", "--dir", dir]),
    );
    expect(missingArgument.code).not.toBe(0);
    expect(missingArgument.stderr).toContain(
      "Usage: bun run combie investigate <resource-id> [--save]",
    );

    const unknown = await capture(() =>
      main(["investigate", "vercel:project:missing", "--dir", dir]),
    );
    expect(unknown.code).not.toBe(0);
    expect(unknown.stderr).toContain("Resource not found");
    expect(unknown.stderr).toContain("combie resources");
  });

  test("investigate renders subject, related histories, and evidence offline", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.isInitialized();
    const repository = createResource({
      provider: "github",
      providerResourceId: "cli_repo",
      kind: "repository",
      name: "cli-repo",
      metadata: { fullName: "user/cli-repo" },
    });
    const project = createResource({
      provider: "vercel",
      providerResourceId: "cli_prj",
      kind: "project",
      name: "cli-app",
      metadata: {},
    });
    store.applyResource(repository, {
      id: "cli-repo-base",
      observedAt: "2026-08-08T08:00:00.000Z",
    });
    store.applyResource(project, {
      id: "cli-prj-base",
      observedAt: "2026-08-08T08:00:00.000Z",
    });
    store.applyResource(
      { ...project, name: "cli-app-renamed" },
      { id: "cli-prj-change", observedAt: "2026-08-08T09:00:00.000Z" },
    );
    store.upsertRelationship(
      createRelationship({
        sourceResourceId: repository.id,
        targetResourceId: project.id,
        kind: "source_for",
        evidence: {
          source: "vercel",
          mechanism: "git_repository_reference",
          repository: "user/cli-repo",
        },
      }),
    );
    store.close();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("investigate must not call a provider");
    }) as unknown as typeof fetch;
    try {
      const result = await capture(() =>
        main(["investigate", project.id, "--dir", dir]),
      );
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("SUBJECT");
      expect(result.stdout).toContain("cli-app-renamed");
      expect(result.stdout).toContain("KNOWN FACTS");
      expect(result.stdout.indexOf("KNOWN FACTS")).toBeLessThan(
        result.stdout.indexOf("SUBJECT CHANGES"),
      );
      expect(result.stdout).toContain(
        "Vercel deployment evidence for vercel:project:cli_prj has unknown current refresh authority",
      );
      expect(result.stdout).toContain("SUBJECT CHANGES");
      expect(result.stdout).toContain("← source_for");
      expect(result.stdout).toContain(repository.id);
      expect(result.stdout).toContain("RELATED CONTEXT");
      expect(result.stdout).toContain("git_repository_reference");
      expect(result.stdout).toContain("COMBIE OBSERVATIONS (newest first)");
      expect(result.stdout).toContain("Role: subject");
      expect(result.stdout).toContain("Observed: 2026-08-08T09:00:00.000Z");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("investigate --save lists and reopens a retained snapshot", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "sentry",
      providerResourceId: "cli450",
      kind: "project",
      name: "cli-sentry",
      metadata: { organization_slug: "acme" },
    });
    store.applyResource(project, {
      id: "obs-cli",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.close();

    const saved = await capture(() =>
      main(["investigate", project.id, "--save", "--dir", dir]),
    );
    expect(saved.code).toBe(0);
    expect(saved.stdout).toContain("SUBJECT");
    expect(saved.stdout).toContain("Saved investigation snapshot inv:");
    expect(saved.stdout).toContain("from local store state");
    const idMatch = saved.stdout.match(/Saved investigation snapshot (inv:\S+)/);
    expect(idMatch).not.toBeNull();
    const id = idMatch![1]!;

    const listed = await capture(() =>
      main(["investigations", "--dir", dir]),
    );
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain(id);
    expect(listed.stdout).toContain(project.id);

    const reopened = await capture(() =>
      main(["investigation", id, "--dir", dir]),
    );
    expect(reopened.code).toBe(0);
    expect(reopened.stdout).toContain("INVESTIGATION SNAPSHOT");
    expect(reopened.stdout).toContain("not current provider truth");
    expect(reopened.stdout).toContain("cli-sentry");
  });

  test("investigation --compare diffs the snapshot against the current compose", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "sentry",
      providerResourceId: "cmp450",
      kind: "project",
      name: "cmp-sentry",
      metadata: { organization_slug: "acme" },
    });
    store.applyResource(project, {
      id: "obs-cmp",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.close();

    const saved = await capture(() =>
      main(["investigate", project.id, "--save", "--dir", dir]),
    );
    const idMatch = saved.stdout.match(/Saved investigation snapshot (inv:\S+)/);
    expect(idMatch).not.toBeNull();
    const id = idMatch![1]!;

    const store2 = new Store(dir);
    store2.init();
    store2.applyResource(
      createResource({
        provider: "sentry",
        providerResourceId: "cmp450",
        kind: "project",
        name: "cmp-sentry-renamed",
        metadata: { organization_slug: "acme" },
      }),
      { id: "obs-cmp-2", observedAt: "2026-08-16T13:00:00.000Z" },
    );
    store2.close();

    const compared = await capture(() =>
      main(["investigation", id, "--compare", "--dir", dir]),
    );
    expect(compared.code).toBe(0);
    expect(compared.stdout).toContain("INVESTIGATION COMPARE");
    expect(compared.stdout).toContain(`Snapshot: ${id}`);
    expect(compared.stdout).toContain(`Subject: ${project.id}`);
    expect(compared.stdout).toContain("current status: available");
    expect(compared.stdout).toContain("cmp-sentry → cmp-sentry-renamed (CHANGED)");
    expect(compared.stdout).toContain("RELATIONSHIPS");
    expect(compared.stdout).toContain("AUTHORITY CLOCKS");
    expect(compared.stdout).not.toContain("subject_missing");
    expect(compared.stdout).not.toContain("ARTIFACT");

    const reopened = await capture(() =>
      main(["investigation", id, "--dir", dir]),
    );
    expect(reopened.code).toBe(0);
    expect(reopened.stdout).toContain("INVESTIGATION SNAPSHOT");
    expect(reopened.stdout).not.toContain("INVESTIGATION COMPARE");
    expect(reopened.stdout).toContain("ARTIFACT");
    expect(reopened.stdout).toContain(`  handle:     ${id}`);
    expect(reopened.stdout).toContain(
      "  schema:     combie.investigation.snapshot.v048",
    );
    expect(reopened.stdout).toMatch(/  hash:       sha256:[0-9a-f]{64}/);
    expect(reopened.stdout).toContain(
      `  location:   investigations.snapshot_json id=${id}`,
    );
    expect(reopened.stdout).toMatch(
      /  counts:     related=0, subjectChanges=\d+, byteLength=\d+/,
    );
    expect(reopened.stdout).toContain(
      `  retrieve:   bun run combie investigation ${id}`,
    );
    expect(reopened.stdout).not.toMatch(/\/Users\/|artifacts\//);
    expect(reopened.stdout.indexOf("ARTIFACT")).toBeGreaterThan(
      reopened.stdout.indexOf("INVESTIGATION SNAPSHOT"),
    );
  });

  test("investigation --compare reports subject_missing and still exits 0", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "sentry",
      providerResourceId: "cmp451",
      kind: "project",
      name: "cmp-gone",
      metadata: { organization_slug: "acme" },
    });
    store.applyResource(project, {
      id: "obs-cmp-gone",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.close();

    const saved = await capture(() =>
      main(["investigate", project.id, "--save", "--dir", dir]),
    );
    const idMatch = saved.stdout.match(/Saved investigation snapshot (inv:\S+)/);
    const id = idMatch![1]!;

    const db = new Database(dbPath(dir));
    db.exec(`DELETE FROM resources WHERE id = '${project.id}'`);
    db.close();

    const compared = await capture(() =>
      main(["investigation", id, "--compare", "--dir", dir]),
    );
    expect(compared.code).toBe(0);
    expect(compared.stdout).toContain(`Snapshot: ${id}`);
    expect(compared.stdout).toContain("subject_missing");
    expect(compared.stdout).toContain("remains reopenable");
    expect(compared.stdout).not.toContain("RELATIONSHIPS");

    const listed = await capture(() =>
      main(["investigations", "--dir", dir]),
    );
    expect(listed.stdout).toContain(id);
  });

  test("investigations --resource lists only that subject and survives subject deletion", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "sentry",
      providerResourceId: "cli450",
      kind: "project",
      name: "cli-sentry",
      metadata: { organization_slug: "acme" },
    });
    const repo = createResource({
      provider: "github",
      providerResourceId: "cli1001",
      kind: "repository",
      name: "cli/api",
      metadata: {},
    });
    store.applyResource(project, {
      id: "obs-cli",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.applyResource(repo, {
      id: "obs-cli-repo",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.close();

    const savedA = await capture(() =>
      main(["investigate", project.id, "--save", "--dir", dir]),
    );
    const idA = savedA.stdout.match(/Saved investigation snapshot (inv:\S+)/)![1]!;
    const savedB = await capture(() =>
      main(["investigate", repo.id, "--save", "--dir", dir]),
    );
    const idB = savedB.stdout.match(/Saved investigation snapshot (inv:\S+)/)![1]!;

    const filtered = await capture(() =>
      main(["investigations", "--resource", project.id, "--dir", dir]),
    );
    expect(filtered.code).toBe(0);
    expect(filtered.stdout).toContain(idA);
    expect(filtered.stdout).not.toContain(idB);
    expect(filtered.stdout).toContain(project.id);

    const db = new Database(dbPath(dir));
    db.exec(`DELETE FROM resources WHERE id = '${project.id}'`);
    db.close();

    const afterDelete = await capture(() =>
      main(["investigations", "--resource", project.id, "--dir", dir]),
    );
    expect(afterDelete.code).toBe(0);
    expect(afterDelete.stdout).toContain(idA);
    expect(afterDelete.stdout).not.toContain("Resource not found");

    const unfiltered = await capture(() =>
      main(["investigations", "--dir", dir]),
    );
    expect(unfiltered.stdout).toContain(idA);
    expect(unfiltered.stdout).toContain(idB);
  });

  test("investigations --resource with zero snapshots exits 0 with subject-empty copy", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const empty = await capture(() =>
      main(["investigations", "--resource", "sentry:project:none", "--dir", dir]),
    );
    expect(empty.code).toBe(0);
    expect(empty.stdout).toContain(
      "No investigation snapshots saved for subject sentry:project:none",
    );
    expect(empty.stdout).not.toContain("No investigation snapshots saved yet.");
    expect(empty.stdout).not.toContain("Resource not found");
  });

  test("investigations --resource requires a value and help lists the flag", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const bare = await capture(() =>
      main(["investigations", "--resource", "--dir", dir]),
    );
    expect(bare.code).toBe(1);
    expect(bare.stderr).toContain("--resource requires a resource id");

    const blank = await capture(() =>
      main(["investigations", "--resource", "", "--dir", dir]),
    );
    expect(blank.code).toBe(1);
    expect(blank.stderr).toContain("--resource requires a resource id");

    const help = await capture(() => main(["help", "--all"]));
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("--resource <resource-id>");
    expect(help.stdout).toContain(
      'With "investigation" / "investigations": list snapshots for one subject',
    );
  });

  test("investigation with no id lists snapshots and --compare still needs an id", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const listed = await capture(() => main(["investigation", "--dir", dir]));
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("No investigation snapshots saved yet.");

    const compareNoId = await capture(() =>
      main(["investigation", "--compare", "--dir", dir]),
    );
    expect(compareNoId.code).toBe(1);
    expect(compareNoId.stderr).toContain(
      "investigation <investigation-id> [--compare]",
    );

    const help = await capture(() => main(["help", "--all"]));
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("--compare");
    expect(help.stdout).toContain(
      'With "investigation <id>": compare snapshot to current compose',
    );
  });

  test("resolution records against a saved investigation and lists by subject", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "sentry",
      providerResourceId: "res450",
      kind: "project",
      name: "res-sentry",
      metadata: { organization_slug: "acme" },
    });
    store.applyResource(project, {
      id: "obs-res",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.close();

    const saved = await capture(() =>
      main(["investigate", project.id, "--save", "--dir", dir]),
    );
    const idMatch = saved.stdout.match(/Saved investigation snapshot (inv:\S+)/);
    expect(idMatch).not.toBeNull();
    const invId = idMatch![1]!;

    const recorded = await capture(() =>
      main([
        "resolution",
        "--investigation",
        invId,
        "--decision",
        "Rollback 1.4.2",
        "--action",
        "Reverted deployment to 1.4.1",
        "--outcome",
        "Errors returned to baseline",
        "--dir",
        dir,
      ]),
    );
    expect(recorded.code).toBe(0);
    expect(recorded.stdout).toContain("Recorded resolution res:");
    expect(recorded.stdout).toContain("organizational response");
    expect(recorded.stdout).not.toMatch(/incident/i);
    const resMatch = recorded.stdout.match(/Recorded resolution (res:\S+)/);
    expect(resMatch).not.toBeNull();
    const resId = resMatch![1]!;

    const shown = await capture(() =>
      main(["resolution", resId, "--dir", dir]),
    );
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain("RESOLUTION");
    expect(shown.stdout).toContain("DECISION");
    expect(shown.stdout).toContain("Rollback 1.4.2");
    expect(shown.stdout).toContain("ACTION");
    expect(shown.stdout).toContain("OUTCOME");
    expect(shown.stdout).toContain("not current provider truth");

    const listedInv = await capture(() =>
      main(["resolutions", "--investigation", invId, "--dir", dir]),
    );
    expect(listedInv.code).toBe(0);
    expect(listedInv.stdout).toContain(resId);
    expect(listedInv.stdout).toContain(invId);

    const listedSubject = await capture(() =>
      main(["resolutions", "--resource", project.id, "--dir", dir]),
    );
    expect(listedSubject.code).toBe(0);
    expect(listedSubject.stdout).toContain(resId);

    const db = new Database(dbPath(dir));
    db.exec(`DELETE FROM resources WHERE id = '${project.id}'`);
    db.close();

    const afterDelete = await capture(() =>
      main(["resolutions", "--resource", project.id, "--dir", dir]),
    );
    expect(afterDelete.code).toBe(0);
    expect(afterDelete.stdout).toContain(resId);

    const reopened = await capture(() =>
      main(["investigation", invId, "--dir", dir]),
    );
    expect(reopened.code).toBe(0);
    expect(reopened.stdout).toContain("INVESTIGATION SNAPSHOT");
    expect(reopened.stdout).toContain("RESOLUTION MEMORY");
    expect(reopened.stdout).toContain(resId);
    expect(reopened.stdout).toContain("Rollback 1.4.2");
    expect(reopened.stdout).not.toContain("INCIDENT MEMORY");
    expect(reopened.stdout).not.toMatch(/\nINCIDENT\n/);

    const live = await capture(() =>
      main(["investigate", project.id, "--dir", dir]),
    );
    expect(live.code).toBe(1);
    expect(live.stderr).toContain("Resource not found");
    expect(live.stdout).not.toContain("RESOLUTION MEMORY");
  });

  test("resolution --investigation without fields lists; empty --decision still errors", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const listed = await capture(() =>
      main(["resolution", "--investigation", "inv:x", "--dir", dir]),
    );
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain(
      "No resolutions recorded for investigation inv:x.",
    );

    const blankDecision = await capture(() =>
      main([
        "resolution",
        "--investigation",
        "inv:x",
        "--decision",
        "--dir",
        dir,
      ]),
    );
    expect(blankDecision.code).toBe(1);
    expect(blankDecision.stderr).toContain("--decision requires text");

    const help = await capture(() => main(["help", "--all"]));
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("resolution");
    expect(help.stdout).toContain("resolutions");
    expect(help.stdout).toContain("--decision <text>");
    expect(help.stdout).toContain("--action <text>");
    expect(help.stdout).toContain("--outcome <text>");
    expect(help.stdout).not.toContain("resolved: true");
    expect(help.stdout).toContain("Resolution memory");
    expect(help.stdout).toContain("recorded text");
    expect(help.stdout).toContain("--evidence <id>");
  });

  test("resolution --evidence attaches exact local ids shown on show, reopen, and live investigate", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "vercel",
      providerResourceId: "prj_evidence",
      kind: "project",
      name: "ev-demo",
      metadata: { accountId: "team_1" },
    });
    store.applyResource(project, {
      id: "obs-ev",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.upsertVercelDeployment({
      provider: "vercel",
      uid: "dpl_abc",
      resourceId: project.id,
      projectId: "prj_evidence",
      readyState: "READY",
      state: "READY",
      target: "production",
      createdAtMs: 1723201000000,
      buildingAtMs: 1723201005000,
      readyAtMs: 1723201300000,
      observedAt: "2026-08-16T12:00:00.000Z",
      source: "git",
      gitCommitSha: null,
    });
    store.upsertVercelDeployment({
      provider: "vercel",
      uid: "dpl_xyz",
      resourceId: project.id,
      projectId: "prj_evidence",
      readyState: "READY",
      state: "READY",
      target: "production",
      createdAtMs: 1723202000000,
      buildingAtMs: 1723202005000,
      readyAtMs: 1723202300000,
      observedAt: "2026-08-16T13:00:00.000Z",
      source: "git",
      gitCommitSha: null,
    });
    store.close();

    const saved = await capture(() =>
      main(["investigate", project.id, "--save", "--dir", dir]),
    );
    expect(saved.code).toBe(0);
    const invMatch = saved.stdout.match(/Saved investigation snapshot (inv:\S+)/);
    expect(invMatch).not.toBeNull();
    const invId = invMatch![1]!;

    const recorded = await capture(() =>
      main([
        "resolution",
        "--investigation",
        invId,
        "--decision",
        "Rollback 1.4.2",
        "--action",
        "Reverted deploy",
        "--evidence",
        "dpl_abc",
        "--evidence",
        "dpl_xyz",
        "--dir",
        dir,
      ]),
    );
    expect(recorded.code).toBe(0);
    expect(recorded.stdout).toContain("Recorded resolution res:");
    const resMatch = recorded.stdout.match(/Recorded resolution (res:\S+)/);
    expect(resMatch).not.toBeNull();
    const resId = resMatch![1]!;

    const shown = await capture(() =>
      main(["resolution", resId, "--dir", dir]),
    );
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain("RESOLUTION");
    expect(shown.stdout).toContain("DECISION");
    expect(shown.stdout).toContain("Rollback 1.4.2");
    expect(shown.stdout.split("\n")).toContain("EVIDENCE");
    expect(shown.stdout.split("\n")).toContain("dpl_abc");
    expect(shown.stdout.split("\n")).toContain("dpl_xyz");

    const reopened = await capture(() =>
      main(["investigation", invId, "--dir", dir]),
    );
    expect(reopened.code).toBe(0);
    expect(reopened.stdout).toContain("RESOLUTION MEMORY");
    expect(reopened.stdout.split("\n")).toContain("EVIDENCE");
    expect(reopened.stdout.split("\n")).toContain("dpl_abc");
    expect(reopened.stdout.split("\n")).toContain("dpl_xyz");

    const live = await capture(() =>
      main(["investigate", project.id, "--dir", dir]),
    );
    expect(live.code).toBe(0);
    expect(live.stdout).toContain("RESOLUTION MEMORY");
    expect(live.stdout.split("\n")).toContain("EVIDENCE");
    expect(live.stdout.split("\n")).toContain("dpl_abc");
    expect(live.stdout.split("\n")).toContain("dpl_xyz");

    const listed = await capture(() =>
      main(["resolutions", "--investigation", invId, "--dir", dir]),
    );
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain(resId);
    expect(listed.stdout).not.toContain("EVIDENCE");
    expect(listed.stdout).not.toContain("dpl_abc");
  });

  test("resolution --evidence errors: no value, unknown id, evidence-only, show-with-evidence", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "vercel",
      providerResourceId: "prj_evidence_err",
      kind: "project",
      name: "ev-err",
      metadata: { accountId: "team_1" },
    });
    store.applyResource(project, {
      id: "obs-ev-err",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.upsertVercelDeployment({
      provider: "vercel",
      uid: "dpl_abc",
      resourceId: project.id,
      projectId: "prj_evidence_err",
      readyState: "READY",
      state: "READY",
      target: "production",
      createdAtMs: 1723201000000,
      buildingAtMs: null,
      readyAtMs: null,
      observedAt: "2026-08-16T12:00:00.000Z",
      source: "git",
      gitCommitSha: null,
    });
    store.close();

    const saved = await capture(() =>
      main(["investigate", project.id, "--save", "--dir", dir]),
    );
    const invMatch = saved.stdout.match(/Saved investigation snapshot (inv:\S+)/);
    expect(invMatch).not.toBeNull();
    const invId = invMatch![1]!;

    const noValue = await capture(() =>
      main([
        "resolution",
        "--investigation",
        invId,
        "--decision",
        "Rollback",
        "--evidence",
        "--dir",
        dir,
      ]),
    );
    expect(noValue.code).toBe(1);
    expect(noValue.stderr).toMatch(/-evidence requires an evidence id/);

    const unknown = await capture(() =>
      main([
        "resolution",
        "--investigation",
        invId,
        "--decision",
        "Rollback",
        "--evidence",
        "dpl_nope",
        "--dir",
        dir,
      ]),
    );
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("Evidence id not found");
    expect(unknown.stderr).toMatch(/investigate/i);

    const evidenceOnly = await capture(() =>
      main([
        "resolution",
        "--investigation",
        invId,
        "--evidence",
        "dpl_abc",
        "--dir",
        dir,
      ]),
    );
    expect(evidenceOnly.code).toBe(0);
    expect(evidenceOnly.stdout).toContain(
      "No resolutions recorded for evidence dpl_abc.",
    );

    const showWithEvidence = await capture(() =>
      main([
        "resolution",
        "res:missing",
        "--evidence",
        "dpl_abc",
        "--dir",
        dir,
      ]),
    );
    expect(showWithEvidence.code).toBe(1);
    expect(showWithEvidence.stderr).toContain("requires --investigation");

    const listed = await capture(() =>
      main(["resolutions", "--dir", dir]),
    );
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("No resolutions recorded yet.");
  });

  test("resolutions known-empty for a subject exits 0", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const result = await capture(() =>
      main([
        "resolutions",
        "--resource",
        "sentry:project:never-used",
        "--dir",
        dir,
      ]),
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      "No resolutions recorded for subject sentry:project:never-used",
    );
  });

  test("resolutions --evidence lists only rows that attached that exact id", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "vercel",
      providerResourceId: "prj_evlist",
      kind: "project",
      name: "ev-list",
      metadata: { accountId: "team_1" },
    });
    store.applyResource(project, {
      id: "obs-ev-list",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.upsertVercelDeployment({
      provider: "vercel",
      uid: "dpl_abc",
      resourceId: project.id,
      projectId: "prj_evlist",
      readyState: "READY",
      state: "READY",
      target: "production",
      createdAtMs: 1723201000000,
      buildingAtMs: 1723201005000,
      readyAtMs: 1723201300000,
      observedAt: "2026-08-16T12:00:00.000Z",
      source: "git",
      gitCommitSha: null,
    });
    store.upsertVercelDeployment({
      provider: "vercel",
      uid: "dpl_xyz",
      resourceId: project.id,
      projectId: "prj_evlist",
      readyState: "READY",
      state: "READY",
      target: "production",
      createdAtMs: 1723202000000,
      buildingAtMs: 1723202005000,
      readyAtMs: 1723202300000,
      observedAt: "2026-08-16T13:00:00.000Z",
      source: "git",
      gitCommitSha: null,
    });
    store.close();

    const savedA = await capture(() =>
      main(["investigate", project.id, "--save", "--dir", dir]),
    );
    expect(savedA.code).toBe(0);
    const invAMatch = savedA.stdout.match(/Saved investigation snapshot (inv:\S+)/);
    expect(invAMatch).not.toBeNull();
    const invA = invAMatch![1]!;

    const savedB = await capture(() =>
      main(["investigate", project.id, "--save", "--dir", dir]),
    );
    expect(savedB.code).toBe(0);
    const invBMatch = savedB.stdout.match(/Saved investigation snapshot (inv:\S+)/);
    expect(invBMatch).not.toBeNull();
    const invB = invBMatch![1]!;

    const recordedA = await capture(() =>
      main([
        "resolution",
        "--investigation",
        invA,
        "--decision",
        "Rollback 1.4.2",
        "--evidence",
        "dpl_abc",
        "--dir",
        dir,
      ]),
    );
    expect(recordedA.code).toBe(0);
    const resAMatch = recordedA.stdout.match(/Recorded resolution (res:\S+)/);
    expect(resAMatch).not.toBeNull();
    const resA = resAMatch![1]!;

    const recordedB = await capture(() =>
      main([
        "resolution",
        "--investigation",
        invB,
        "--decision",
        "Wait instead",
        "--evidence",
        "dpl_xyz",
        "--dir",
        dir,
      ]),
    );
    expect(recordedB.code).toBe(0);
    const resBMatch = recordedB.stdout.match(/Recorded resolution (res:\S+)/);
    expect(resBMatch).not.toBeNull();
    const resB = resBMatch![1]!;

    const listed = await capture(() =>
      main(["resolutions", "--evidence", "dpl_abc", "--dir", dir]),
    );
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain(resA);
    expect(listed.stdout).not.toContain(resB);
    expect(listed.stdout).not.toContain("EVIDENCE");
    expect(listed.stdout).not.toContain("dpl_abc");
  });

  test("resolutions --evidence with zero matches exits 0 with evidence-empty copy", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const result = await capture(() =>
      main(["resolutions", "--evidence", "dpl_nope", "--dir", dir]),
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      "No resolutions recorded for evidence dpl_nope.",
    );
    expect(result.stdout).not.toContain("No resolutions recorded yet.");
    expect(result.stdout).not.toContain("EVIDENCE_ID_NOT_FOUND");
  });

  test("resolutions --evidence requires a value", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const bare = await capture(() =>
      main(["resolutions", "--evidence", "--dir", dir]),
    );
    expect(bare.code).toBe(1);
    expect(bare.stderr).toContain("--evidence requires an evidence id");

    const blank = await capture(() =>
      main(["resolutions", "--evidence", "", "--dir", dir]),
    );
    expect(blank.code).toBe(1);
    expect(blank.stderr).toContain("--evidence requires an evidence id");
  });

  test("resolutions --evidence is one exact id on the list", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const repeated = await capture(() =>
      main([
        "resolutions",
        "--evidence",
        "dpl_abc",
        "--evidence",
        "dpl_xyz",
        "--dir",
        dir,
      ]),
    );
    expect(repeated.code).toBe(1);
    expect(repeated.stderr).toContain("takes one exact id");
    expect(repeated.stdout).not.toContain("No resolutions recorded");
  });

  test("resolutions --evidence ANDs with --investigation", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "vercel",
      providerResourceId: "prj_evand",
      kind: "project",
      name: "ev-and",
      metadata: { accountId: "team_1" },
    });
    store.applyResource(project, {
      id: "obs-ev-and",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.upsertVercelDeployment({
      provider: "vercel",
      uid: "dpl_abc",
      resourceId: project.id,
      projectId: "prj_evand",
      readyState: "READY",
      state: "READY",
      target: "production",
      createdAtMs: 1723201000000,
      buildingAtMs: 1723201005000,
      readyAtMs: 1723201300000,
      observedAt: "2026-08-16T12:00:00.000Z",
      source: "git",
      gitCommitSha: null,
    });
    store.close();

    const savedA = await capture(() =>
      main(["investigate", project.id, "--save", "--dir", dir]),
    );
    const invAMatch = savedA.stdout.match(/Saved investigation snapshot (inv:\S+)/);
    expect(invAMatch).not.toBeNull();
    const invA = invAMatch![1]!;

    const savedB = await capture(() =>
      main(["investigate", project.id, "--save", "--dir", dir]),
    );
    const invBMatch = savedB.stdout.match(/Saved investigation snapshot (inv:\S+)/);
    expect(invBMatch).not.toBeNull();
    const invB = invBMatch![1]!;

    const recordedA = await capture(() =>
      main([
        "resolution",
        "--investigation",
        invA,
        "--decision",
        "Rollback",
        "--evidence",
        "dpl_abc",
        "--dir",
        dir,
      ]),
    );
    const resAMatch = recordedA.stdout.match(/Recorded resolution (res:\S+)/);
    expect(resAMatch).not.toBeNull();
    const resA = resAMatch![1]!;

    const recordedB = await capture(() =>
      main([
        "resolution",
        "--investigation",
        invB,
        "--decision",
        "Wait",
        "--evidence",
        "dpl_abc",
        "--dir",
        dir,
      ]),
    );
    const resBMatch = recordedB.stdout.match(/Recorded resolution (res:\S+)/);
    expect(resBMatch).not.toBeNull();
    const resB = resBMatch![1]!;

    const intersection = await capture(() =>
      main([
        "resolutions",
        "--investigation",
        invB,
        "--evidence",
        "dpl_abc",
        "--dir",
        dir,
      ]),
    );
    expect(intersection.code).toBe(0);
    expect(intersection.stdout).toContain(resB);
    expect(intersection.stdout).not.toContain(resA);
  });

  test("resolutions --evidence survives subject Resource deletion", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "vercel",
      providerResourceId: "prj_evdel",
      kind: "project",
      name: "ev-del",
      metadata: { accountId: "team_1" },
    });
    store.applyResource(project, {
      id: "obs-ev-del",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.upsertVercelDeployment({
      provider: "vercel",
      uid: "dpl_abc",
      resourceId: project.id,
      projectId: "prj_evdel",
      readyState: "READY",
      state: "READY",
      target: "production",
      createdAtMs: 1723201000000,
      buildingAtMs: 1723201005000,
      readyAtMs: 1723201300000,
      observedAt: "2026-08-16T12:00:00.000Z",
      source: "git",
      gitCommitSha: null,
    });
    store.close();

    const saved = await capture(() =>
      main(["investigate", project.id, "--save", "--dir", dir]),
    );
    const invMatch = saved.stdout.match(/Saved investigation snapshot (inv:\S+)/);
    expect(invMatch).not.toBeNull();
    const invId = invMatch![1]!;

    const recorded = await capture(() =>
      main([
        "resolution",
        "--investigation",
        invId,
        "--decision",
        "Rollback",
        "--evidence",
        "dpl_abc",
        "--dir",
        dir,
      ]),
    );
    const resMatch = recorded.stdout.match(/Recorded resolution (res:\S+)/);
    expect(resMatch).not.toBeNull();
    const resId = resMatch![1]!;

    const db = new Database(dbPath(dir));
    db.exec(`DELETE FROM resources WHERE id = '${project.id}'`);
    db.close();

    const listed = await capture(() =>
      main(["resolutions", "--evidence", "dpl_abc", "--dir", dir]),
    );
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain(resId);
    expect(listed.stdout).not.toContain("Resource not found");
  });

  test("resolution --resource records without a saved investigation", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "sentry",
      providerResourceId: "res057",
      kind: "project",
      name: "res-anchored",
      metadata: { organization_slug: "acme" },
    });
    store.applyResource(project, {
      id: "obs-res057",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.close();

    const recorded = await capture(() =>
      main([
        "resolution",
        "--resource",
        project.id,
        "--decision",
        "Rollback",
        "--action",
        "Reverted deploy",
        "--outcome",
        "Errors dropped",
        "--dir",
        dir,
      ]),
    );
    expect(recorded.code).toBe(0);
    expect(recorded.stdout).toContain("Recorded resolution res:");
    expect(recorded.stdout).toContain(`subject ${project.id}`);
    expect(recorded.stdout).not.toContain("investigation ");
    expect(recorded.stdout).not.toMatch(/incident/i);
    const resMatch = recorded.stdout.match(/Recorded resolution (res:\S+)/);
    expect(resMatch).not.toBeNull();
    const resId = resMatch![1]!;

    const shown = await capture(() => main(["resolution", resId, "--dir", dir]));
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain("SUBJECT:");
    expect(shown.stdout).not.toContain("INVESTIGATION:");

    const listed = await capture(() =>
      main(["resolutions", "--resource", project.id, "--dir", dir]),
    );
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain(resId);
    expect(listed.stdout).toContain("-");

    const live = await capture(() =>
      main(["investigate", project.id, "--dir", dir]),
    );
    expect(live.code).toBe(0);
    expect(live.stdout).toContain("RESOLUTION MEMORY");
    expect(live.stdout).toContain(resId);
    expect(live.stdout).toContain("Rollback");
    const memoryLine = live.stdout
      .split("\n")
      .find((line) => line.startsWith(resId));
    expect(memoryLine).toBeDefined();
    expect(memoryLine).not.toContain("inv:");

    const both = await capture(() =>
      main([
        "resolution",
        "--investigation",
        "inv:x",
        "--resource",
        project.id,
        "--decision",
        "Nope",
        "--dir",
        dir,
      ]),
    );
    expect(both.code).toBe(1);
    expect(both.stderr).toContain("--investigation");
    expect(both.stderr).toContain("--resource");

    const missing = await capture(() =>
      main([
        "resolution",
        "--resource",
        "--decision",
        "Nope",
        "--dir",
        dir,
      ]),
    );
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("--resource requires a resource id");

    const unknown = await capture(() =>
      main([
        "resolution",
        "--resource",
        "sentry:project:missing",
        "--decision",
        "Nope",
        "--dir",
        dir,
      ]),
    );
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("Resource not found");
  });

  test("help --all lists resource-anchored resolution record", async () => {
    const help = await capture(() => main(["help", "--all"]));
    expect(help.code).toBe(0);
    expect(help.stdout).toContain(
      'or with "resolution" a resource to record against (no saved investigation)',
    );
    expect(help.stdout).toContain(
      'resolution --resource vercel:project:prj_abc --decision "Rollback"',
    );
    expect(help.stdout).toContain(
      'resolution --investigation inv:… --decision "Rollback" --action "Reverted deploy" --outcome "Errors dropped"',
    );
  });

  test("incident groups existing resolutions and help lists the command", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "sentry",
      providerResourceId: "inc058",
      kind: "project",
      name: "inc-sentry",
      metadata: { organization_slug: "acme" },
    });
    store.applyResource(project, {
      id: "obs-inc058",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.close();

    const first = await capture(() =>
      main([
        "resolution",
        "--resource",
        project.id,
        "--decision",
        "Rollback",
        "--dir",
        dir,
      ]),
    );
    expect(first.code).toBe(0);
    const resA = first.stdout.match(/res:[a-f0-9-]+/)![0];
    const second = await capture(() =>
      main([
        "resolution",
        "--resource",
        project.id,
        "--decision",
        "Hold deploys",
        "--dir",
        dir,
      ]),
    );
    expect(second.code).toBe(0);
    const resB = second.stdout.match(/res:[a-f0-9-]+/)![0];

    const grouped = await capture(() =>
      main([
        "incident",
        "--resolution",
        resA,
        "--resolution",
        resB,
        "--title",
        "API error spike",
        "--dir",
        dir,
      ]),
    );
    expect(grouped.code).toBe(0);
    expect(grouped.stdout).toMatch(/^Recorded incident inc:/);
    expect(grouped.stdout).toContain("API error spike");
    expect(grouped.stdout).toContain(resA);
    expect(grouped.stdout).toContain(resB);
    const incId = grouped.stdout.match(/inc:[a-f0-9-]+/)![0];

    const listed = await capture(() => main(["incidents", "--dir", dir]));
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain(incId);
    expect(listed.stdout).toContain("API error spike");
    expect(listed.stdout).not.toContain(resA);
    expect(listed.stdout).toContain("2");

    const shown = await capture(() => main(["incident", incId, "--dir", dir]));
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain("INCIDENT");
    expect(shown.stdout).toContain(resA);
    expect(shown.stdout).toContain(resB);
    expect(shown.stdout).not.toContain("Rollback");

    const resolutionShow = await capture(() =>
      main(["resolution", resA, "--dir", dir]),
    );
    expect(resolutionShow.code).toBe(0);
    expect(resolutionShow.stdout).not.toMatch(/INCIDENT/);

    const investigated = await capture(() =>
      main(["investigate", project.id, "--dir", dir]),
    );
    expect(investigated.code).toBe(0);
    expect(investigated.stdout).toContain("RESOLUTION MEMORY");
    expect(investigated.stdout).not.toMatch(/\nINCIDENT\n/);

    const emptyOther = await capture(() =>
      main([
        "incident",
        "--resolution",
        resA,
        "--resolution",
        resB,
        "--dir",
        dir,
      ]),
    );
    expect(emptyOther.code).toBe(1);
    expect(emptyOther.stderr).toContain("already belongs to another Incident");

    const bothAnchors = await capture(() =>
      main([
        "incident",
        "--resolution",
        resA,
        "--resolution",
        resB,
        "--investigation",
        "inv:x",
        "--dir",
        dir,
      ]),
    );
    expect(bothAnchors.code).toBe(1);
    expect(bothAnchors.stderr).toContain("--investigation");

    const viaResource = await capture(() =>
      main([
        "incident",
        "--resource",
        project.id,
        "--resolution",
        resA,
        "--resolution",
        resB,
        "--dir",
        dir,
      ]),
    );
    expect(viaResource.code).toBe(1);
    expect(viaResource.stderr).toContain("--resource");

    const one = await capture(() =>
      main(["incident", "--resolution", resA, "--dir", dir]),
    );
    expect(one.code).toBe(1);
    expect(one.stderr).toContain("at least two distinct");

    const missing = await capture(() =>
      main(["incident", "--resolution", "--dir", dir]),
    );
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("--resolution requires a resolution id");

    const unknown = await capture(() =>
      main(["incident", "inc:missing", "--dir", dir]),
    );
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("Incident not found");

    const help = await capture(() => main(["help", "--all"]));
    expect(help.code).toBe(0);
    expect(help.stdout).toContain(
      "incident [id]                List, record, show, or update an explicit incident grouping of resolutions",
    );
    expect(help.stdout).toContain(
      'incident --resolution res:… --resolution res:… --title "API error spike"',
    );
    expect(help.stdout).toContain("incident inc:… --resolution res:…");
    expect(help.stdout).toContain(
      'resolution --investigation inv:… --decision "Rollback" --action "Reverted deploy" --outcome "Errors dropped"',
    );
    expect(help.stdout).toContain(
      'resolution --resource vercel:project:prj_abc --decision "Rollback"',
    );
  });

  test("incidents --resolution and --resource retrieve by exact membership", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const subjectA = createResource({
      provider: "sentry",
      providerResourceId: "inc060a",
      kind: "project",
      name: "inc060-a",
      metadata: { organization_slug: "acme" },
    });
    const subjectB = createResource({
      provider: "sentry",
      providerResourceId: "inc060b",
      kind: "project",
      name: "inc060-b",
      metadata: { organization_slug: "acme" },
    });
    store.applyResource(subjectA, {
      id: "obs-inc060a",
      observedAt: "2026-08-18T00:00:00.000Z",
    });
    store.applyResource(subjectB, {
      id: "obs-inc060b",
      observedAt: "2026-08-18T00:00:00.000Z",
    });
    store.close();

    const first = await capture(() =>
      main([
        "resolution",
        "--resource",
        subjectA.id,
        "--decision",
        "Rollback",
        "--dir",
        dir,
      ]),
    );
    expect(first.code).toBe(0);
    const resA = first.stdout.match(/res:[a-f0-9-]+/)![0];
    const second = await capture(() =>
      main([
        "resolution",
        "--resource",
        subjectB.id,
        "--decision",
        "Hold deploys",
        "--dir",
        dir,
      ]),
    );
    expect(second.code).toBe(0);
    const resB = second.stdout.match(/res:[a-f0-9-]+/)![0];

    const third = await capture(() =>
      main([
        "resolution",
        "--resource",
        subjectA.id,
        "--decision",
        "Scale up",
        "--dir",
        dir,
      ]),
    );
    expect(third.code).toBe(0);
    const resC = third.stdout.match(/res:[a-f0-9-]+/)![0];
    const fourth = await capture(() =>
      main([
        "resolution",
        "--resource",
        subjectB.id,
        "--decision",
        "Scale down",
        "--dir",
        dir,
      ]),
    );
    expect(fourth.code).toBe(0);
    const resD = fourth.stdout.match(/res:[a-f0-9-]+/)![0];

    const cross = await capture(() =>
      main([
        "incident",
        "--resolution",
        resA,
        "--resolution",
        resB,
        "--title",
        "Cross subject spike",
        "--dir",
        dir,
      ]),
    );
    expect(cross.code).toBe(0);
    const crossInc = cross.stdout.match(/inc:[a-f0-9-]+/)![0];
    const other = await capture(() =>
      main([
        "incident",
        "--resolution",
        resC,
        "--resolution",
        resD,
        "--title",
        "Other spike",
        "--dir",
        dir,
      ]),
    );
    expect(other.code).toBe(0);
    const otherInc = other.stdout.match(/inc:[a-f0-9-]+/)![0];

    const byResolution = await capture(() =>
      main(["incidents", "--resolution", resA, "--dir", dir]),
    );
    expect(byResolution.code).toBe(0);
    expect(byResolution.stdout).toContain(crossInc);
    expect(byResolution.stdout).not.toContain(otherInc);
    expect(byResolution.stdout).toContain("Cross subject spike");
    expect(byResolution.stdout).not.toContain(resA);
    expect(byResolution.stdout).toContain("2");

    const bySubjectA = await capture(() =>
      main(["incidents", "--resource", subjectA.id, "--dir", dir]),
    );
    expect(bySubjectA.code).toBe(0);
    expect(bySubjectA.stdout).toContain(crossInc);
    expect(bySubjectA.stdout).toContain(otherInc);
    expect(bySubjectA.stdout).not.toContain(resA);

    const bySubjectB = await capture(() =>
      main(["incidents", "--resource", subjectB.id, "--dir", dir]),
    );
    expect(bySubjectB.code).toBe(0);
    expect(bySubjectB.stdout).toContain(crossInc);
    expect(bySubjectB.stdout).toContain(otherInc);

    const both = await capture(() =>
      main([
        "incidents",
        "--resolution",
        resA,
        "--resource",
        subjectB.id,
        "--dir",
        dir,
      ]),
    );
    expect(both.code).toBe(0);
    expect(both.stdout).toContain(crossInc);
    expect(both.stdout).not.toContain(otherInc);

    const substring = await capture(() =>
      main([
        "incidents",
        "--resolution",
        resA.slice(0, resA.length - 2),
        "--dir",
        dir,
      ]),
    );
    expect(substring.code).toBe(0);
    expect(substring.stdout).not.toContain(crossInc);

    const unknownRes = await capture(() =>
      main(["incidents", "--resolution", "res:missing", "--dir", dir]),
    );
    expect(unknownRes.code).toBe(0);
    expect(unknownRes.stdout).toContain(
      "No incidents recorded for resolution res:missing.",
    );
    expect(unknownRes.stdout).not.toContain("No incidents recorded yet.");
    expect(unknownRes.stdout).not.toContain("RESOLUTION_NOT_FOUND");

    const unknownSubject = await capture(() =>
      main([
        "incidents",
        "--resource",
        "sentry:project:never-used",
        "--dir",
        dir,
      ]),
    );
    expect(unknownSubject.code).toBe(0);
    expect(unknownSubject.stdout).toContain(
      "No incidents recorded for subject sentry:project:never-used.",
    );
    expect(unknownSubject.stdout).not.toContain("No incidents recorded yet.");
    expect(unknownSubject.stdout).not.toContain("RESOURCE_NOT_FOUND");

    const db = new Database(dbPath(dir));
    db.exec(`DELETE FROM resources WHERE id = '${subjectA.id}'`);
    db.close();
    const deleted = await capture(() =>
      main(["incidents", "--resource", subjectA.id, "--dir", dir]),
    );
    expect(deleted.code).toBe(0);
    expect(deleted.stdout).toContain(crossInc);

    const repeated = await capture(() =>
      main([
        "incidents",
        "--resolution",
        resA,
        "--resolution",
        resB,
        "--dir",
        dir,
      ]),
    );
    expect(repeated.code).toBe(1);
    expect(repeated.stderr).toContain("takes one exact id");
    expect(repeated.stdout).not.toContain("No incidents recorded");

    const viaInvestigation = await capture(() =>
      main([
        "incidents",
        "--investigation",
        "inv:missing",
        "--dir",
        dir,
      ]),
    );
    expect(viaInvestigation.code).toBe(0);
    expect(viaInvestigation.stdout).toContain(
      "No incidents recorded for investigation inv:missing.",
    );
    expect(viaInvestigation.stdout).not.toContain("INVESTIGATION_NOT_FOUND");
    expect(viaInvestigation.stderr).not.toContain("does not filter");

    const blankResolution = await capture(() =>
      main(["incidents", "--resolution", "--dir", dir]),
    );
    expect(blankResolution.code).toBe(1);
    expect(blankResolution.stderr).toContain(
      "--resolution requires a resolution id",
    );

    const blankResource = await capture(() =>
      main(["incidents", "--resource", "", "--dir", dir]),
    );
    expect(blankResource.code).toBe(1);
    expect(blankResource.stderr).toContain("--resource requires a resource id");

    const unfiltered = await capture(() => main(["incidents", "--dir", dir]));
    expect(unfiltered.code).toBe(0);
    expect(unfiltered.stdout).toContain(crossInc);
    expect(unfiltered.stdout).toContain(otherInc);

    const shown = await capture(() => main(["incident", crossInc, "--dir", dir]));
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain(resA);
    expect(shown.stdout).toContain(resB);

    const help = await capture(() => main(["help", "--all"]));
    expect(help.code).toBe(0);
    expect(help.stdout).toContain(
      'With "incidents": list groupings that named that exact resolution id (membership only; one exact id)',
    );
    expect(help.stdout).toContain(
      'With "incident" / "incidents": list groupings with a member Resolution on one subject',
    );
    expect(help.stdout).toContain("incidents --resolution res:…");
    expect(help.stdout).toContain(
      "incidents --resource github:repository:1001",
    );
  });

  test("incidents --investigation retrieves by exact investigation membership (Sprint 063)", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const subject = createResource({
      provider: "sentry",
      providerResourceId: "inc063",
      kind: "project",
      name: "inc063-sentry",
      metadata: { organization_slug: "acme" },
    });
    store.applyResource(subject, {
      id: "obs-inc063",
      observedAt: "2026-08-18T00:00:00.000Z",
    });
    store.close();

    const saved = await capture(() =>
      main(["investigate", subject.id, "--save", "--dir", dir]),
    );
    expect(saved.code).toBe(0);
    const invId = saved.stdout.match(
      /Saved investigation snapshot (inv:\S+)/,
    )![1]!;

    const invRes = await capture(() =>
      main([
        "resolution",
        "--investigation",
        invId,
        "--decision",
        "Rollback",
        "--dir",
        dir,
      ]),
    );
    expect(invRes.code).toBe(0);
    const resA = invRes.stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const resourceRes = await capture(() =>
      main([
        "resolution",
        "--resource",
        subject.id,
        "--decision",
        "Hold deploys",
        "--dir",
        dir,
      ]),
    );
    const resB = resourceRes.stdout.match(/Recorded resolution (res:\S+)/)![1]!;

    const grouped = await capture(() =>
      main([
        "incident",
        "--resolution",
        resA,
        "--resolution",
        resB,
        "--title",
        "Mixed spike",
        "--dir",
        dir,
      ]),
    );
    expect(grouped.code).toBe(0);
    const mixedInc = grouped.stdout.match(/Recorded incident (inc:\S+)/)![1]!;

    const onlyA = await capture(() =>
      main([
        "resolution",
        "--resource",
        subject.id,
        "--decision",
        "Scale up",
        "--dir",
        dir,
      ]),
    );
    const resC = onlyA.stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const onlyB = await capture(() =>
      main([
        "resolution",
        "--resource",
        subject.id,
        "--decision",
        "Scale down",
        "--dir",
        dir,
      ]),
    );
    const resD = onlyB.stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const resourceOnly = await capture(() =>
      main([
        "incident",
        "--resolution",
        resC,
        "--resolution",
        resD,
        "--title",
        "Resource only",
        "--dir",
        dir,
      ]),
    );
    const resourceInc = resourceOnly.stdout.match(
      /Recorded incident (inc:\S+)/,
    )![1]!;

    const byInvestigation = await capture(() =>
      main(["incidents", "--investigation", invId, "--dir", dir]),
    );
    expect(byInvestigation.code).toBe(0);
    expect(byInvestigation.stdout).toContain(mixedInc);
    expect(byInvestigation.stdout).toContain("Mixed spike");
    expect(byInvestigation.stdout).toContain("2");
    expect(byInvestigation.stdout).not.toContain(resourceInc);
    expect(byInvestigation.stdout).not.toContain(resA);
    expect(byInvestigation.stdout).not.toContain("Rollback");

    const andResource = await capture(() =>
      main([
        "incidents",
        "--investigation",
        invId,
        "--resource",
        subject.id,
        "--dir",
        dir,
      ]),
    );
    expect(andResource.code).toBe(0);
    expect(andResource.stdout).toContain(mixedInc);
    expect(andResource.stdout).not.toContain(resourceInc);

    const andResolution = await capture(() =>
      main([
        "incidents",
        "--investigation",
        invId,
        "--resolution",
        resA,
        "--dir",
        dir,
      ]),
    );
    expect(andResolution.code).toBe(0);
    expect(andResolution.stdout).toContain(mixedInc);

    const byResolution = await capture(() =>
      main(["incidents", "--resolution", resA, "--dir", dir]),
    );
    expect(byResolution.code).toBe(0);
    expect(byResolution.stdout).toContain(mixedInc);

    const unfiltered = await capture(() => main(["incidents", "--dir", dir]));
    expect(unfiltered.code).toBe(0);
    expect(unfiltered.stdout).toContain(mixedInc);
    expect(unfiltered.stdout).toContain(resourceInc);

    const reopened = await capture(() =>
      main(["investigation", invId, "--dir", dir]),
    );
    expect(reopened.code).toBe(0);
    expect(reopened.stdout).toContain("INCIDENT MEMORY");
    expect(reopened.stdout).toContain(mixedInc);

    const compared = await capture(() =>
      main(["investigation", invId, "--compare", "--dir", dir]),
    );
    expect(compared.code).toBe(0);
    expect(compared.stdout).toContain("INVESTIGATION COMPARE");
    expect(compared.stdout).not.toContain("INCIDENT MEMORY");

    const unknown = await capture(() =>
      main(["incidents", "--investigation", "inv:missing", "--dir", dir]),
    );
    expect(unknown.code).toBe(0);
    expect(unknown.stdout).toContain(
      "No incidents recorded for investigation inv:missing.",
    );
    expect(unknown.stdout).not.toContain("INVESTIGATION_NOT_FOUND");

    const repeated = await capture(() =>
      main([
        "incidents",
        "--investigation",
        invId,
        "--investigation",
        invId,
        "--dir",
        dir,
      ]),
    );
    expect(repeated.code).toBe(1);
    expect(repeated.stderr).toContain("takes one exact id");
    expect(repeated.stdout).not.toContain("No incidents recorded");

    const blank = await capture(() =>
      main(["incidents", "--investigation", "--dir", dir]),
    );
    expect(blank.code).toBe(1);
    expect(blank.stderr).toContain("--investigation requires an investigation id");

    const help = await capture(() => main(["help", "--all"]));
    expect(help.code).toBe(0);
    expect(help.stdout).toContain(
      'With "incident" / "incidents": list groupings with a member Resolution recorded against that investigation (membership only; one exact id)',
    );
    expect(help.stdout).toContain("incidents --investigation inv:…");
  });

  test("resolution --incident records into an existing grouping (Sprint 061)", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "sentry",
      providerResourceId: "inc061",
      kind: "project",
      name: "inc-anchor-sentry",
      metadata: { organization_slug: "acme" },
    });
    store.applyResource(project, {
      id: "obs-inc061",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.close();

    const resA = await capture(() =>
      main([
        "resolution",
        "--resource",
        project.id,
        "--decision",
        "Rollback",
        "--dir",
        dir,
      ]),
    );
    expect(resA.code).toBe(0);
    const resAId = resA.stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const resB = await capture(() =>
      main([
        "resolution",
        "--resource",
        project.id,
        "--decision",
        "Hold deploys",
        "--dir",
        dir,
      ]),
    );
    const resBId = resB.stdout.match(/Recorded resolution (res:\S+)/)![1]!;

    const grouped = await capture(() =>
      main([
        "incident",
        "--resolution",
        resAId,
        "--resolution",
        resBId,
        "--title",
        "API error spike",
        "--dir",
        dir,
      ]),
    );
    expect(grouped.code).toBe(0);
    const incId = grouped.stdout.match(/Recorded incident (inc:\S+)/)![1]!;

    const recorded = await capture(() =>
      main([
        "resolution",
        "--incident",
        incId,
        "--decision",
        "Keep holding",
        "--action",
        "Held deploys",
        "--outcome",
        "Spike passed",
        "--dir",
        dir,
      ]),
    );
    expect(recorded.code).toBe(0);
    expect(recorded.stdout).toContain(`incident ${incId}`);
    expect(recorded.stdout).toContain(`subject ${project.id}`);
    const newRes = recorded.stdout.match(/Recorded resolution (res:\S+)/)![1]!;

    const shown = await capture(() =>
      main(["resolution", newRes, "--dir", dir]),
    );
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain("DECISION");
    expect(shown.stdout).toContain("Keep holding");
    expect(shown.stdout).not.toMatch(/INCIDENT|incident/i);
    expect(shown.stdout).not.toContain("INVESTIGATION:");

    const incidentShow = await capture(() =>
      main(["incident", incId, "--dir", dir]),
    );
    expect(incidentShow.code).toBe(0);
    expect(incidentShow.stdout).toContain(resAId);
    expect(incidentShow.stdout).toContain(resBId);
    expect(incidentShow.stdout).toContain(newRes);

    const incidentsList = await capture(() =>
      main(["incidents", "--dir", dir]),
    );
    expect(incidentsList.code).toBe(0);
    expect(incidentsList.stdout).toContain(incId);
    expect(incidentsList.stdout).toContain("3");

    const byNewRes = await capture(() =>
      main(["incidents", "--resolution", newRes, "--dir", dir]),
    );
    expect(byNewRes.code).toBe(0);
    expect(byNewRes.stdout).toContain(incId);

    const investigate = await capture(() =>
      main(["investigate", project.id, "--dir", dir]),
    );
    expect(investigate.code).toBe(0);
    expect(investigate.stdout).toContain("RESOLUTION MEMORY");
    expect(investigate.stdout).toContain(newRes);
    expect(investigate.stdout).toContain("INCIDENT MEMORY");
    expect(investigate.stdout).toContain(incId);

    const xorResource = await capture(() =>
      main([
        "resolution",
        "--incident",
        incId,
        "--resource",
        project.id,
        "--decision",
        "Both",
        "--dir",
        dir,
      ]),
    );
    expect(xorResource.code).toBe(0);
    expect(xorResource.stdout).toContain(`incident ${incId}`);
    expect(xorResource.stdout).toContain(`subject ${project.id}`);

    const xorInvestigation = await capture(() =>
      main([
        "resolution",
        "--incident",
        incId,
        "--investigation",
        "inv:missing",
        "--decision",
        "Both",
        "--dir",
        dir,
      ]),
    );
    expect(xorInvestigation.code).toBe(1);
    expect(xorInvestigation.stderr).toContain("--incident");

    const unknown = await capture(() =>
      main([
        "resolution",
        "--incident",
        "inc:missing",
        "--decision",
        "Rollback",
        "--dir",
        dir,
      ]),
    );
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("Incident not found");

    const repeated = await capture(() =>
      main([
        "resolution",
        "--incident",
        incId,
        "--incident",
        incId,
        "--decision",
        "Both",
        "--dir",
        dir,
      ]),
    );
    expect(repeated.code).toBe(1);
    expect(repeated.stderr).toContain("one exact id");

    const blank = await capture(() =>
      main([
        "resolution",
        "--incident",
        "--decision",
        "Rollback",
        "--dir",
        dir,
      ]),
    );
    expect(blank.code).toBe(1);
    expect(blank.stderr).toContain("--incident requires");

    const help = await capture(() => main(["help", "--all"]));
    expect(help.code).toBe(0);
    expect(help.stdout).toContain(
      'With "resolution": existing incident grouping to record',
    );
    expect(help.stdout).toContain("resolution --incident inc:…");

    const extra = await capture(() =>
      main([
        "resolution",
        "--resource",
        project.id,
        "--decision",
        "Ungrouped later",
        "--dir",
        dir,
      ]),
    );
    const extraId = extra.stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const leftover = await capture(() =>
      main([
        "incident",
        "--resolution",
        newRes,
        "--resolution",
        extraId,
        "--dir",
        dir,
      ]),
    );
    expect(leftover.code).toBe(1);
    expect(leftover.stderr).toMatch(/already belongs to another Incident/);

    const saved = await capture(() =>
      main(["investigate", project.id, "--save", "--dir", dir]),
    );
    expect(saved.code).toBe(0);
    const invId = saved.stdout.match(
      /Saved investigation snapshot (inv:\S+)/,
    )![1]!;
    const storeAfter = new Store(dir);
    storeAfter.init();
    const snapshotRow = storeAfter.getInvestigationRow(invId);
    expect(snapshotRow?.snapshotJson).not.toContain("INCIDENT MEMORY");
    expect(snapshotRow?.snapshotJson).not.toContain(newRes);
    storeAfter.close();

    const compared = await capture(() =>
      main(["investigation", invId, "--compare", "--dir", dir]),
    );
    expect(compared.code).toBe(0);
    expect(compared.stdout).toContain("INVESTIGATION COMPARE");
    expect(compared.stdout).not.toContain("INCIDENT MEMORY");
    expect(compared.stdout).not.toContain(newRes);

    const investigationFilter = await capture(() =>
      main(["incidents", "--investigation", invId, "--dir", dir]),
    );
    expect(investigationFilter.code).toBe(0);
    expect(investigationFilter.stdout).toContain(
      `No incidents recorded for investigation ${invId}.`,
    );
    expect(investigationFilter.stdout).not.toContain("INVESTIGATION_NOT_FOUND");
  });

  test("resolution --incident --resource records on a mixed grouping (Sprint 064)", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const sentry = createResource({
      provider: "sentry",
      providerResourceId: "inc064s",
      kind: "project",
      name: "inc064-sentry",
      metadata: { organization_slug: "acme" },
    });
    const github = createResource({
      provider: "github",
      providerResourceId: "inc064repo",
      kind: "repository",
      name: "acme/inc064",
      metadata: {},
    });
    store.applyResource(sentry, {
      id: "obs-inc064s",
      observedAt: "2026-08-18T00:00:00.000Z",
    });
    store.applyResource(github, {
      id: "obs-inc064g",
      observedAt: "2026-08-18T00:00:00.000Z",
    });
    store.close();

    const resAId = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          sentry.id,
          "--decision",
          "Rollback",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const resBId = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          github.id,
          "--decision",
          "Hold deploys",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const grouped = await capture(() =>
      main([
        "incident",
        "--resolution",
        resAId,
        "--resolution",
        resBId,
        "--title",
        "Cross spike",
        "--dir",
        dir,
      ]),
    );
    expect(grouped.code).toBe(0);
    const incId = grouped.stdout.match(/Recorded incident (inc:\S+)/)![1]!;

    const ambiguous = await capture(() =>
      main([
        "resolution",
        "--incident",
        incId,
        "--decision",
        "Keep holding",
        "--dir",
        dir,
      ]),
    );
    expect(ambiguous.code).toBe(1);
    expect(ambiguous.stderr).toContain("spans different subjects");

    const recorded = await capture(() =>
      main([
        "resolution",
        "--incident",
        incId,
        "--resource",
        sentry.id,
        "--decision",
        "Keep holding",
        "--dir",
        dir,
      ]),
    );
    expect(recorded.code).toBe(0);
    expect(recorded.stdout).toContain(`incident ${incId}`);
    expect(recorded.stdout).toContain(`subject ${sentry.id}`);
    const newRes = recorded.stdout.match(/Recorded resolution (res:\S+)/)![1]!;

    const shown = await capture(() =>
      main(["resolution", newRes, "--dir", dir]),
    );
    expect(shown.code).toBe(0);
    expect(shown.stdout).not.toMatch(/INCIDENT|incident/i);

    const incidentShow = await capture(() =>
      main(["incident", incId, "--dir", dir]),
    );
    expect(incidentShow.code).toBe(0);
    expect(incidentShow.stdout).toContain(newRes);

    const missingResource = await capture(() =>
      main([
        "resolution",
        "--incident",
        incId,
        "--resource",
        "sentry:project:never-used",
        "--decision",
        "Nope",
        "--dir",
        dir,
      ]),
    );
    expect(missingResource.code).toBe(1);
    expect(missingResource.stderr).toContain("Resource not found");

    const other = createResource({
      provider: "sentry",
      providerResourceId: "inc064other",
      kind: "project",
      name: "inc064-other",
      metadata: { organization_slug: "acme" },
    });
    const storeOther = new Store(dir);
    storeOther.init();
    storeOther.applyResource(other, {
      id: "obs-inc064o",
      observedAt: "2026-08-18T00:00:00.000Z",
    });
    storeOther.close();
    const unrelated = await capture(() =>
      main([
        "resolution",
        "--incident",
        incId,
        "--resource",
        other.id,
        "--decision",
        "Nope",
        "--dir",
        dir,
      ]),
    );
    expect(unrelated.code).toBe(1);
    expect(unrelated.stderr).toContain("no loadable member on subject");

    const xorInvestigation = await capture(() =>
      main([
        "resolution",
        "--incident",
        incId,
        "--investigation",
        "inv:missing",
        "--decision",
        "Both",
        "--dir",
        dir,
      ]),
    );
    expect(xorInvestigation.code).toBe(1);
    expect(xorInvestigation.stderr).toContain("exactly one of");

    const repeated = await capture(() =>
      main([
        "resolution",
        "--incident",
        incId,
        "--resource",
        sentry.id,
        "--resource",
        github.id,
        "--decision",
        "Both",
        "--dir",
        dir,
      ]),
    );
    expect(repeated.code).toBe(1);
    expect(repeated.stderr).toContain("takes one exact id");

    const help = await capture(() => main(["help", "--all"]));
    expect(help.stdout).toContain(
      "resolution --incident inc:… --resource github:repository:1001",
    );
    expect(help.stdout).toContain("named with --resource");
  });

  test("incident <id> --resolution appends an existing ungrouped member (Sprint 062)", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "sentry",
      providerResourceId: "inc062",
      kind: "project",
      name: "inc-append-sentry",
      metadata: { organization_slug: "acme" },
    });
    const other = createResource({
      provider: "github",
      providerResourceId: "inc062repo",
      kind: "repository",
      name: "acme/inc-append",
      metadata: {},
    });
    store.applyResource(project, {
      id: "obs-inc062",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.applyResource(other, {
      id: "obs-inc062repo",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.close();

    const resA = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Rollback",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const resB = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Hold deploys",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const grouped = await capture(() =>
      main([
        "incident",
        "--resolution",
        resA,
        "--resolution",
        resB,
        "--title",
        "API error spike",
        "--dir",
        dir,
      ]),
    );
    expect(grouped.code).toBe(0);
    expect(grouped.stdout).toMatch(/^Recorded incident inc:/);
    const incId = grouped.stdout.match(/Recorded incident (inc:\S+)/)![1]!;

    const resD = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Scale up",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;

    const appended = await capture(() =>
      main(["incident", incId, "--resolution", resD, "--dir", dir]),
    );
    expect(appended.code).toBe(0);
    expect(appended.stdout).toContain(`Updated incident ${incId}`);
    expect(appended.stdout).toContain(resD);
    expect(appended.stdout).not.toMatch(/^Recorded incident/);

    const shown = await capture(() => main(["incident", incId, "--dir", dir]));
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain(resA);
    expect(shown.stdout).toContain(resB);
    expect(shown.stdout).toContain(resD);

    const resShow = await capture(() =>
      main(["resolution", resD, "--dir", dir]),
    );
    expect(resShow.code).toBe(0);
    expect(resShow.stdout).not.toMatch(/INCIDENT|incident/i);

    const listed = await capture(() => main(["incidents", "--dir", dir]));
    expect(listed.stdout).toContain("3");
    const byD = await capture(() =>
      main(["incidents", "--resolution", resD, "--dir", dir]),
    );
    expect(byD.code).toBe(0);
    expect(byD.stdout).toContain(incId);

    const live = await capture(() =>
      main(["investigate", project.id, "--dir", dir]),
    );
    expect(live.stdout).toContain("INCIDENT MEMORY");
    expect(live.stdout).toContain(resD);

    const unchanged = await capture(() =>
      main(["incident", incId, "--resolution", resD, "--dir", dir]),
    );
    expect(unchanged.code).toBe(1);
    expect(unchanged.stderr).toContain("already includes");

    const titled = await capture(() =>
      main([
        "incident",
        incId,
        "--resolution",
        resD,
        "--title",
        "Nope",
        "--dir",
        dir,
      ]),
    );
    expect(titled.code).toBe(1);
    expect(titled.stderr).toContain("--title");

    const unknown = await capture(() =>
      main([
        "incident",
        "inc:missing",
        "--resolution",
        resD,
        "--dir",
        dir,
      ]),
    );
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("Incident not found");

    const resOther = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          other.id,
          "--decision",
          "Repo hold",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const cross = await capture(() =>
      main(["incident", incId, "--resolution", resOther, "--dir", dir]),
    );
    expect(cross.code).toBe(0);
    const mixedWrite = await capture(() =>
      main([
        "resolution",
        "--incident",
        incId,
        "--decision",
        "Ambiguous",
        "--dir",
        dir,
      ]),
    );
    expect(mixedWrite.code).toBe(1);
    expect(mixedWrite.stderr).toMatch(/spans different subjects/);

    const createStill = await capture(() =>
      main([
        "incident",
        "--resolution",
        resA,
        "--resolution",
        resOther,
        "--dir",
        dir,
      ]),
    );
    expect(createStill.code).toBe(1);
    expect(createStill.stderr).toMatch(/already belongs to another Incident/);

    const help = await capture(() => main(["help", "--all"]));
    expect(help.stdout).toContain("incident inc:… --resolution res:…");
    expect(help.stdout).toContain(
      "With \"incident\": exact Resolution id to group at create",
    );
  });

  test("incident <id> --remove-resolution detaches a current member (Sprint 065)", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "sentry",
      providerResourceId: "inc065",
      kind: "project",
      name: "inc-remove-sentry",
      metadata: { organization_slug: "acme" },
    });
    store.applyResource(project, {
      id: "obs-inc065",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.close();

    const resA = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Rollback",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const resB = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Hold deploys",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const resC = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Scale up",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;

    const grouped = await capture(() =>
      main([
        "incident",
        "--resolution",
        resA,
        "--resolution",
        resB,
        "--resolution",
        resC,
        "--title",
        "API error spike",
        "--dir",
        dir,
      ]),
    );
    expect(grouped.code).toBe(0);
    const incId = grouped.stdout.match(/Recorded incident (inc:\S+)/)![1]!;

    const removed = await capture(() =>
      main(["incident", incId, "--remove-resolution", resC, "--dir", dir]),
    );
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain(`Removed from incident ${incId}`);
    expect(removed.stdout).toContain(resC);
    expect(removed.stdout).not.toMatch(/^Recorded incident/);
    expect(removed.stdout).not.toMatch(/^Updated incident/);

    const shown = await capture(() => main(["incident", incId, "--dir", dir]));
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain(resA);
    expect(shown.stdout).toContain(resB);
    expect(shown.stdout).not.toContain(resC);

    const resShow = await capture(() =>
      main(["resolution", resC, "--dir", dir]),
    );
    expect(resShow.code).toBe(0);
    expect(resShow.stdout).toContain(resC);
    expect(resShow.stdout).not.toMatch(/INCIDENT|incident/i);

    const listed = await capture(() => main(["incidents", "--dir", dir]));
    expect(listed.stdout).toContain("2");
    const byC = await capture(() =>
      main(["incidents", "--resolution", resC, "--dir", dir]),
    );
    expect(byC.code).toBe(0);
    expect(byC.stdout).toContain("No incidents recorded for resolution");
    expect(byC.stdout).not.toContain(incId);

    const live = await capture(() =>
      main(["investigate", project.id, "--dir", dir]),
    );
    expect(live.stdout).toContain("INCIDENT MEMORY");
    const incidentMemory = live.stdout.slice(
      live.stdout.indexOf("INCIDENT MEMORY"),
    );
    expect(incidentMemory).toContain(resA);
    expect(incidentMemory).toContain(resB);
    expect(incidentMemory).not.toContain(resC);

    const reappend = await capture(() =>
      main(["incident", incId, "--resolution", resC, "--dir", dir]),
    );
    expect(reappend.code).toBe(0);
    expect(reappend.stdout).toContain(`Updated incident ${incId}`);

    const wouldLeaveOne = await capture(() =>
      main([
        "incident",
        incId,
        "--remove-resolution",
        resA,
        "--remove-resolution",
        resB,
        "--remove-resolution",
        resC,
        "--dir",
        dir,
      ]),
    );
    expect(wouldLeaveOne.code).toBe(1);
    expect(wouldLeaveOne.stderr).toMatch(/at least two/);
    const stillThree = await capture(() =>
      main(["incident", incId, "--dir", dir]),
    );
    expect(stillThree.stdout).toContain(resA);
    expect(stillThree.stdout).toContain(resB);
    expect(stillThree.stdout).toContain(resC);

    const titled = await capture(() =>
      main([
        "incident",
        incId,
        "--remove-resolution",
        resC,
        "--title",
        "Nope",
        "--dir",
        dir,
      ]),
    );
    expect(titled.code).toBe(1);
    expect(titled.stderr).toContain("--title");

    const mixed = await capture(() =>
      main([
        "incident",
        incId,
        "--resolution",
        resC,
        "--remove-resolution",
        resC,
        "--dir",
        dir,
      ]),
    );
    expect(mixed.code).toBe(1);
    expect(mixed.stderr).toMatch(/--resolution|--remove-resolution/);

    const noPositional = await capture(() =>
      main(["incident", "--remove-resolution", resC, "--dir", dir]),
    );
    expect(noPositional.code).toBe(1);
    expect(noPositional.stderr).toMatch(/--remove-resolution|Usage:/);

    const groupingSnapshots = await capture(() =>
      main([
        "incident",
        "--investigation",
        "inv:a",
        "--investigation",
        "inv:b",
        "--dir",
        dir,
      ]),
    );
    expect(groupingSnapshots.code).toBe(1);
    expect(groupingSnapshots.stderr).toContain(
      "--investigation takes one exact id",
    );

    const help = await capture(() => main(["help", "--all"]));
    expect(help.stdout).toContain(
      "incident inc:… --remove-resolution res:…",
    );
    expect(help.stdout).toContain("--remove-resolution");
  });

  test("incident <id> --title retitles an existing grouping (Sprint 066)", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "sentry",
      providerResourceId: "inc066",
      kind: "project",
      name: "inc-retitle-sentry",
      metadata: { organization_slug: "acme" },
    });
    store.applyResource(project, {
      id: "obs-inc066",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.close();

    const resA = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Rollback",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const resB = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Hold deploys",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;

    const grouped = await capture(() =>
      main([
        "incident",
        "--resolution",
        resA,
        "--resolution",
        resB,
        "--title",
        "API error spike",
        "--dir",
        dir,
      ]),
    );
    expect(grouped.code).toBe(0);
    const incId = grouped.stdout.match(/Recorded incident (inc:\S+)/)![1]!;

    const renamed = await capture(() =>
      main(["incident", incId, "--title", "Better name", "--dir", dir]),
    );
    expect(renamed.code).toBe(0);
    expect(renamed.stdout).toContain(`Renamed incident ${incId}`);
    expect(renamed.stdout).toContain("Better name");
    expect(renamed.stdout).not.toMatch(/^Recorded incident/);
    expect(renamed.stdout).not.toMatch(/^Updated incident/);
    expect(renamed.stdout).not.toMatch(/^Removed from incident/);

    const shown = await capture(() => main(["incident", incId, "--dir", dir]));
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain("TITLE");
    expect(shown.stdout).toContain("Better name");
    expect(shown.stdout).not.toContain("API error spike");
    expect(shown.stdout).toContain(resA);
    expect(shown.stdout).toContain(resB);

    const listed = await capture(() => main(["incidents", "--dir", dir]));
    expect(listed.stdout).toContain("Better name");
    expect(listed.stdout).not.toContain("API error spike");

    const live = await capture(() =>
      main(["investigate", project.id, "--dir", dir]),
    );
    const incidentMemory = live.stdout.slice(
      live.stdout.indexOf("INCIDENT MEMORY"),
    );
    expect(incidentMemory).toContain("Better name");
    expect(incidentMemory).not.toContain("API error spike");

    const unchanged = await capture(() =>
      main(["incident", incId, "--title", "Better name", "--dir", dir]),
    );
    expect(unchanged.code).toBe(1);
    expect(unchanged.stderr).toContain("already");

    const untitled = await capture(() =>
      main([
        "incident",
        "--resolution",
        resA,
        "--resolution",
        resB,
        "--dir",
        dir,
      ]),
    );
    expect(untitled.code).toBe(1);
    expect(untitled.stderr).toMatch(/already belongs to another Incident/);

    const omitted = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Scale up",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const omittedB = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Hold again",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const created = await capture(() =>
      main([
        "incident",
        "--resolution",
        omitted,
        "--resolution",
        omittedB,
        "--dir",
        dir,
      ]),
    );
    expect(created.code).toBe(0);
    const inc2 = created.stdout.match(/Recorded incident (inc:\S+)/)![1]!;
    const firstTitle = await capture(() =>
      main(["incident", inc2, "--title", "Named later", "--dir", dir]),
    );
    expect(firstTitle.code).toBe(0);
    expect(firstTitle.stdout).toContain("Named later");

    const appendTitled = await capture(() =>
      main([
        "incident",
        incId,
        "--resolution",
        omitted,
        "--title",
        "Nope",
        "--dir",
        dir,
      ]),
    );
    expect(appendTitled.code).toBe(1);
    expect(appendTitled.stderr).toContain("--title");

    const removeTitled = await capture(() =>
      main([
        "incident",
        incId,
        "--remove-resolution",
        resB,
        "--title",
        "Nope",
        "--dir",
        dir,
      ]),
    );
    expect(removeTitled.code).toBe(1);
    expect(removeTitled.stderr).toContain("--title");

    const noPositional = await capture(() =>
      main(["incident", "--title", "Nope", "--dir", dir]),
    );
    expect(noPositional.code).toBe(1);
    expect(noPositional.stderr).toMatch(/Usage:/);

    const repeated = await capture(() =>
      main([
        "incident",
        incId,
        "--title",
        "One",
        "--title",
        "Two",
        "--dir",
        dir,
      ]),
    );
    expect(repeated.code).toBe(1);
    expect(repeated.stderr).toContain("one exact");

    const groupingSnapshots = await capture(() =>
      main([
        "incident",
        "--investigation",
        "inv:a",
        "--investigation",
        "inv:b",
        "--dir",
        dir,
      ]),
    );
    expect(groupingSnapshots.code).toBe(1);
    expect(groupingSnapshots.stderr).toContain(
      "--investigation takes one exact id",
    );

    const help = await capture(() => main(["help", "--all"]));
    expect(help.stdout).toContain('incident inc:… --title "');
    expect(help.stdout).toContain("or to retitle");
  });

  test("incident <id> --clear-title omits the stored title (Sprint 067)", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "sentry",
      providerResourceId: "inc067",
      kind: "project",
      name: "inc-clear-sentry",
      metadata: { organization_slug: "acme" },
    });
    store.applyResource(project, {
      id: "obs-inc067",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.close();

    const resA = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Rollback",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const resB = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Hold deploys",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const resC = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Scale up",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const resD = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Hold again",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;

    const grouped = await capture(() =>
      main([
        "incident",
        "--resolution",
        resA,
        "--resolution",
        resB,
        "--title",
        "API error spike",
        "--dir",
        dir,
      ]),
    );
    expect(grouped.code).toBe(0);
    const incId = grouped.stdout.match(/Recorded incident (inc:\S+)/)![1]!;

    const cleared = await capture(() =>
      main(["incident", incId, "--clear-title", "--dir", dir]),
    );
    expect(cleared.code).toBe(0);
    expect(cleared.stdout).toContain(`Cleared incident title ${incId}`);
    expect(cleared.stdout).not.toMatch(/^Recorded incident/);
    expect(cleared.stdout).not.toMatch(/^Renamed incident/);

    const shown = await capture(() => main(["incident", incId, "--dir", dir]));
    expect(shown.code).toBe(0);
    expect(shown.stdout).not.toContain("TITLE");
    expect(shown.stdout).not.toContain("API error spike");
    expect(shown.stdout).toContain(resA);
    expect(shown.stdout).toContain(resB);

    const listed = await capture(() => main(["incidents", "--dir", dir]));
    expect(listed.stdout).not.toContain("API error spike");

    const live = await capture(() =>
      main(["investigate", project.id, "--dir", dir]),
    );
    const incidentMemory = live.stdout.slice(
      live.stdout.indexOf("INCIDENT MEMORY"),
    );
    expect(incidentMemory).toContain("INCIDENT MEMORY");
    expect(incidentMemory).not.toContain("TITLE");
    expect(incidentMemory).not.toContain("API error spike");

    const retitled = await capture(() =>
      main(["incident", incId, "--title", "Named again", "--dir", dir]),
    );
    expect(retitled.code).toBe(0);
    expect(retitled.stdout).toContain("Named again");

    const already = await capture(() =>
      main(["incident", incId, "--clear-title", "--dir", dir]),
    );
    expect(already.code).toBe(0);
    const secondClear = await capture(() =>
      main(["incident", incId, "--clear-title", "--dir", dir]),
    );
    expect(secondClear.code).toBe(1);
    expect(secondClear.stderr).toContain("already");

    const omitted = await capture(() =>
      main([
        "incident",
        "--resolution",
        resC,
        "--resolution",
        resD,
        "--dir",
        dir,
      ]),
    );
    expect(omitted.code).toBe(0);
    const inc2 = omitted.stdout.match(/Recorded incident (inc:\S+)/)![1]!;
    const omittedClear = await capture(() =>
      main(["incident", inc2, "--clear-title", "--dir", dir]),
    );
    expect(omittedClear.code).toBe(1);
    expect(omittedClear.stderr).toContain("already");

    const blankTitle = await capture(() =>
      main(["incident", incId, "--title", "--dir", dir]),
    );
    expect(blankTitle.code).toBe(1);
    expect(blankTitle.stderr).toContain("--title requires text");

    const mixedTitle = await capture(() =>
      main([
        "incident",
        incId,
        "--clear-title",
        "--title",
        "Nope",
        "--dir",
        dir,
      ]),
    );
    expect(mixedTitle.code).toBe(1);
    expect(mixedTitle.stderr).toMatch(/--clear-title|--title/);

    const mixedAppend = await capture(() =>
      main([
        "incident",
        incId,
        "--resolution",
        resC,
        "--clear-title",
        "--dir",
        dir,
      ]),
    );
    expect(mixedAppend.code).toBe(1);
    expect(mixedAppend.stderr).toMatch(/--clear-title|--resolution/);

    const noPositional = await capture(() =>
      main(["incident", "--clear-title", "--dir", dir]),
    );
    expect(noPositional.code).toBe(1);
    expect(noPositional.stderr).toMatch(/--clear-title|Usage:/);

    const withValue = await capture(() =>
      main(["incident", incId, "--clear-title", "extra", "--dir", dir]),
    );
    expect(withValue.code).toBe(1);

    const groupingSnapshots = await capture(() =>
      main([
        "incident",
        "--investigation",
        "inv:a",
        "--investigation",
        "inv:b",
        "--dir",
        dir,
      ]),
    );
    expect(groupingSnapshots.code).toBe(1);
    expect(groupingSnapshots.stderr).toContain(
      "--investigation takes one exact id",
    );

    const help = await capture(() => main(["help", "--all"]));
    expect(help.stdout).toContain("incident inc:… --clear-title");
    expect(help.stdout).toContain("--clear-title");
  });

  test("incident <id> --recorded-at restamps an existing grouping (Sprint 068)", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "sentry",
      providerResourceId: "inc068",
      kind: "project",
      name: "inc-restamp-sentry",
      metadata: { organization_slug: "acme" },
    });
    store.applyResource(project, {
      id: "obs-inc068",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.close();

    const resA = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Rollback",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const resB = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Hold deploys",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const resC = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Scale up",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;

    const grouped = await capture(() =>
      main([
        "incident",
        "--resolution",
        resA,
        "--resolution",
        resB,
        "--title",
        "API error spike",
        "--dir",
        dir,
      ]),
    );
    expect(grouped.code).toBe(0);
    const incId = grouped.stdout.match(/Recorded incident (inc:\S+)/)![1]!;
    const shownBefore = await capture(() =>
      main(["incident", incId, "--dir", dir]),
    );
    const createdAt = shownBefore.stdout.match(
      /Recorded by Combie at (\S+)/,
    )![1]!;
    expect(createdAt).not.toBe("2026-08-17T20:00:00.000Z");

    const restamped = await capture(() =>
      main([
        "incident",
        incId,
        "--recorded-at",
        "2026-08-17T20:00:00.000Z",
        "--dir",
        dir,
      ]),
    );
    expect(restamped.code).toBe(0);
    expect(restamped.stdout).toContain(`Set incident time ${incId}`);
    expect(restamped.stdout).toContain("2026-08-17T20:00:00.000Z");
    expect(restamped.stdout).not.toMatch(/^Recorded incident/);
    expect(restamped.stdout).not.toMatch(/^Renamed incident/);
    expect(restamped.stdout).not.toMatch(/^Cleared incident title/);

    const shown = await capture(() => main(["incident", incId, "--dir", dir]));
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain("Recorded by Combie at 2026-08-17T20:00:00.000Z");
    expect(shown.stdout).not.toContain(createdAt);
    expect(shown.stdout).toContain("TITLE");
    expect(shown.stdout).toContain("API error spike");
    expect(shown.stdout).toContain(resA);
    expect(shown.stdout).toContain(resB);

    const listed = await capture(() => main(["incidents", "--dir", dir]));
    expect(listed.stdout).toContain("2026-08-17T20:00:00.000Z");
    expect(listed.stdout).not.toContain(createdAt);

    const live = await capture(() =>
      main(["investigate", project.id, "--dir", dir]),
    );
    const incidentMemory = live.stdout.slice(
      live.stdout.indexOf("INCIDENT MEMORY"),
    );
    expect(incidentMemory).toContain("2026-08-17T20:00:00.000Z");
    expect(incidentMemory).not.toContain(createdAt);

    const unchanged = await capture(() =>
      main([
        "incident",
        incId,
        "--recorded-at",
        "2026-08-17T20:00:00.000Z",
        "--dir",
        dir,
      ]),
    );
    expect(unchanged.code).toBe(1);
    expect(unchanged.stderr).toContain("already");

    const invalid = await capture(() =>
      main(["incident", incId, "--recorded-at", "Nope", "--dir", dir]),
    );
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toMatch(/ISO|invalid|recorded-at/i);

    const blank = await capture(() =>
      main(["incident", incId, "--recorded-at", "--dir", dir]),
    );
    expect(blank.code).toBe(1);
    expect(blank.stderr).toMatch(/recorded-at|Usage:/i);

    const mixedTitle = await capture(() =>
      main([
        "incident",
        incId,
        "--recorded-at",
        "2026-08-17T21:00:00.000Z",
        "--title",
        "Nope",
        "--dir",
        dir,
      ]),
    );
    expect(mixedTitle.code).toBe(1);
    expect(mixedTitle.stderr).toMatch(/recorded-at|--title/);

    const mixedClear = await capture(() =>
      main([
        "incident",
        incId,
        "--clear-title",
        "--recorded-at",
        "2026-08-17T21:00:00.000Z",
        "--dir",
        dir,
      ]),
    );
    expect(mixedClear.code).toBe(1);
    expect(mixedClear.stderr).toMatch(/recorded-at|clear-title/);

    const mixedAppend = await capture(() =>
      main([
        "incident",
        incId,
        "--resolution",
        resC,
        "--recorded-at",
        "2026-08-17T21:00:00.000Z",
        "--dir",
        dir,
      ]),
    );
    expect(mixedAppend.code).toBe(1);
    expect(mixedAppend.stderr).toMatch(/recorded-at|--resolution/);

    const noPositional = await capture(() =>
      main([
        "incident",
        "--recorded-at",
        "2026-08-17T20:00:00.000Z",
        "--dir",
        dir,
      ]),
    );
    expect(noPositional.code).toBe(1);
    expect(noPositional.stderr).toMatch(/recorded-at|Usage:/);

    const groupingSnapshots = await capture(() =>
      main([
        "incident",
        "--investigation",
        "inv:a",
        "--investigation",
        "inv:b",
        "--dir",
        dir,
      ]),
    );
    expect(groupingSnapshots.code).toBe(1);
    expect(groupingSnapshots.stderr).toContain(
      "--investigation takes one exact id",
    );

    const help = await capture(() => main(["help", "--all"]));
    expect(help.stdout).toContain("incident inc:… --recorded-at");
    expect(help.stdout).toContain("--recorded-at");
  });

  test("incident <id> --occurred-at sets occurrence time on an existing grouping (Sprint 077)", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "sentry",
      providerResourceId: "inc077",
      kind: "project",
      name: "inc-occurred-sentry",
      metadata: { organization_slug: "acme" },
    });
    store.applyResource(project, {
      id: "obs-inc077",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.close();

    const resA = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Rollback",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const resB = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Hold deploys",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const resC = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Scale up",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;

    const grouped = await capture(() =>
      main([
        "incident",
        "--resolution",
        resA,
        "--resolution",
        resB,
        "--title",
        "API error spike",
        "--dir",
        dir,
      ]),
    );
    expect(grouped.code).toBe(0);
    const incId = grouped.stdout.match(/Recorded incident (inc:\S+)/)![1]!;
    const shownBefore = await capture(() =>
      main(["incident", incId, "--dir", dir]),
    );
    expect(shownBefore.stdout).not.toContain("Occurred at");
    const createdAt = shownBefore.stdout.match(
      /Recorded by Combie at (\S+)/,
    )![1]!;

    const setOccurred = await capture(() =>
      main([
        "incident",
        incId,
        "--occurred-at",
        "2026-08-17T14:00:00.000Z",
        "--dir",
        dir,
      ]),
    );
    expect(setOccurred.code).toBe(0);
    expect(setOccurred.stdout).toContain(`Set incident occurrence ${incId}`);
    expect(setOccurred.stdout).toContain("2026-08-17T14:00:00.000Z");
    expect(setOccurred.stdout).not.toMatch(/^Set incident time/);

    const shown = await capture(() => main(["incident", incId, "--dir", dir]));
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain("Occurred at 2026-08-17T14:00:00.000Z");
    expect(shown.stdout).toContain(`Recorded by Combie at ${createdAt}`);
    expect(shown.stdout).toContain("TITLE");
    expect(shown.stdout).toContain("API error spike");
    expect(shown.stdout).toContain(resA);
    expect(shown.stdout).toContain(resB);

    const listed = await capture(() => main(["incidents", "--dir", dir]));
    expect(listed.stdout).toContain(createdAt);
    expect(listed.stdout).not.toContain("2026-08-17T14:00:00.000Z");

    const live = await capture(() =>
      main(["investigate", project.id, "--dir", dir]),
    );
    const incidentMemory = live.stdout.slice(
      live.stdout.indexOf("INCIDENT MEMORY"),
    );
    expect(incidentMemory).toContain("OCCURRED AT");
    expect(incidentMemory).toContain("2026-08-17T14:00:00.000Z");
    expect(incidentMemory).toContain(createdAt);

    const unchanged = await capture(() =>
      main([
        "incident",
        incId,
        "--occurred-at",
        "2026-08-17T14:00:00.000Z",
        "--dir",
        dir,
      ]),
    );
    expect(unchanged.code).toBe(1);
    expect(unchanged.stderr).toContain("already");

    const invalid = await capture(() =>
      main(["incident", incId, "--occurred-at", "Nope", "--dir", dir]),
    );
    expect(invalid.code).toBe(1);

    const blank = await capture(() =>
      main(["incident", incId, "--occurred-at", "--dir", dir]),
    );
    expect(blank.code).toBe(1);

    const mixedTitle = await capture(() =>
      main([
        "incident",
        incId,
        "--occurred-at",
        "2026-08-17T15:00:00.000Z",
        "--title",
        "Nope",
        "--dir",
        dir,
      ]),
    );
    expect(mixedTitle.code).toBe(1);

    const mixedClear = await capture(() =>
      main([
        "incident",
        incId,
        "--clear-title",
        "--occurred-at",
        "2026-08-17T15:00:00.000Z",
        "--dir",
        dir,
      ]),
    );
    expect(mixedClear.code).toBe(1);

    const mixedRestamp = await capture(() =>
      main([
        "incident",
        incId,
        "--recorded-at",
        "2026-08-17T21:00:00.000Z",
        "--occurred-at",
        "2026-08-17T15:00:00.000Z",
        "--dir",
        dir,
      ]),
    );
    expect(mixedRestamp.code).toBe(1);

    const mixedAppend = await capture(() =>
      main([
        "incident",
        incId,
        "--resolution",
        resC,
        "--occurred-at",
        "2026-08-17T15:00:00.000Z",
        "--dir",
        dir,
      ]),
    );
    expect(mixedAppend.code).toBe(1);

    const mixedRemove = await capture(() =>
      main([
        "incident",
        incId,
        "--remove-resolution",
        resA,
        "--occurred-at",
        "2026-08-17T15:00:00.000Z",
        "--dir",
        dir,
      ]),
    );
    expect(mixedRemove.code).toBe(1);

    const noPositional = await capture(() =>
      main([
        "incident",
        "--occurred-at",
        "2026-08-17T14:00:00.000Z",
        "--dir",
        dir,
      ]),
    );
    expect(noPositional.code).toBe(1);

    const groupingSnapshots = await capture(() =>
      main([
        "incident",
        "--investigation",
        "inv:a",
        "--investigation",
        "inv:b",
        "--dir",
        dir,
      ]),
    );
    expect(groupingSnapshots.code).toBe(1);
    expect(groupingSnapshots.stderr).toContain(
      "--investigation takes one exact id",
    );

    const help = await capture(() => main(["help", "--all"]));
    expect(help.stdout).toContain("incident inc:… --occurred-at");
    expect(help.stdout).toContain("--occurred-at");
  });

  test("incident <id> --clear-occurred-at omits the stored occurredAt (Sprint 078)", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "sentry",
      providerResourceId: "inc078",
      kind: "project",
      name: "inc-clear-occurred-sentry",
      metadata: { organization_slug: "acme" },
    });
    store.applyResource(project, {
      id: "obs-inc078",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.close();

    const resA = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Rollback",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const resB = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Hold deploys",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const resC = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Scale up",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const resD = (
      await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          "Hold again",
          "--dir",
          dir,
        ]),
      )
    ).stdout.match(/Recorded resolution (res:\S+)/)![1]!;

    const grouped = await capture(() =>
      main([
        "incident",
        "--resolution",
        resA,
        "--resolution",
        resB,
        "--title",
        "API error spike",
        "--dir",
        dir,
      ]),
    );
    expect(grouped.code).toBe(0);
    const incId = grouped.stdout.match(/Recorded incident (inc:\S+)/)![1]!;
    const shownBefore = await capture(() =>
      main(["incident", incId, "--dir", dir]),
    );
    const createdAt = shownBefore.stdout.match(
      /Recorded by Combie at (\S+)/,
    )![1]!;

    const setOccurred = await capture(() =>
      main([
        "incident",
        incId,
        "--occurred-at",
        "2026-08-17T14:00:00.000Z",
        "--dir",
        dir,
      ]),
    );
    expect(setOccurred.code).toBe(0);

    const cleared = await capture(() =>
      main(["incident", incId, "--clear-occurred-at", "--dir", dir]),
    );
    expect(cleared.code).toBe(0);
    expect(cleared.stdout).toContain(`Cleared incident occurrence ${incId}`);
    expect(cleared.stdout).not.toMatch(/^Recorded incident/);
    expect(cleared.stdout).not.toMatch(/^Updated incident/);
    expect(cleared.stdout).not.toMatch(/^Removed from incident/);
    expect(cleared.stdout).not.toMatch(/^Renamed incident/);
    expect(cleared.stdout).not.toContain("Cleared incident title");
    expect(cleared.stdout).not.toContain("Set incident time");
    expect(cleared.stdout).not.toContain("Set incident occurrence");

    const shown = await capture(() => main(["incident", incId, "--dir", dir]));
    expect(shown.code).toBe(0);
    expect(shown.stdout).not.toContain("Occurred at");
    expect(shown.stdout).toContain(`Recorded by Combie at ${createdAt}`);
    expect(shown.stdout).toContain("TITLE");
    expect(shown.stdout).toContain("API error spike");
    expect(shown.stdout).toContain(resA);
    expect(shown.stdout).toContain(resB);

    const listed = await capture(() => main(["incidents", "--dir", dir]));
    expect(listed.stdout).toContain(createdAt);
    expect(listed.stdout).not.toContain("2026-08-17T14:00:00.000Z");

    const live = await capture(() =>
      main(["investigate", project.id, "--dir", dir]),
    );
    const incidentMemory = live.stdout.slice(
      live.stdout.indexOf("INCIDENT MEMORY"),
    );
    expect(incidentMemory).toContain("INCIDENT MEMORY");
    expect(incidentMemory).not.toContain("OCCURRED AT");
    expect(incidentMemory).not.toContain("2026-08-17T14:00:00.000Z");

    const roundTrip = await capture(() =>
      main([
        "incident",
        incId,
        "--occurred-at",
        "2026-08-17T14:00:00.000Z",
        "--dir",
        dir,
      ]),
    );
    expect(roundTrip.code).toBe(0);

    const clearAgain = await capture(() =>
      main(["incident", incId, "--clear-occurred-at", "--dir", dir]),
    );
    expect(clearAgain.code).toBe(0);

    const already = await capture(() =>
      main(["incident", incId, "--clear-occurred-at", "--dir", dir]),
    );
    expect(already.code).toBe(1);
    expect(already.stderr).toContain("already");

    const omitted = await capture(() =>
      main([
        "incident",
        "--resolution",
        resC,
        "--resolution",
        resD,
        "--dir",
        dir,
      ]),
    );
    expect(omitted.code).toBe(0);
    const inc2 = omitted.stdout.match(/Recorded incident (inc:\S+)/)![1]!;
    const omittedClear = await capture(() =>
      main(["incident", inc2, "--clear-occurred-at", "--dir", dir]),
    );
    expect(omittedClear.code).toBe(1);
    expect(omittedClear.stderr).toContain("already");

    const withValue = await capture(() =>
      main(["incident", incId, "--clear-occurred-at", "extra", "--dir", dir]),
    );
    expect(withValue.code).toBe(1);

    const mixedOccurred = await capture(() =>
      main([
        "incident",
        incId,
        "--clear-occurred-at",
        "--occurred-at",
        "2026-08-17T15:00:00.000Z",
        "--dir",
        dir,
      ]),
    );
    expect(mixedOccurred.code).toBe(1);
    expect(mixedOccurred.stderr).toMatch(/--clear-occurred-at|--occurred-at/);

    const mixedClearTitle = await capture(() =>
      main([
        "incident",
        incId,
        "--clear-title",
        "--clear-occurred-at",
        "--dir",
        dir,
      ]),
    );
    expect(mixedClearTitle.code).toBe(1);
    expect(mixedClearTitle.stderr).toMatch(/--clear-title|--clear-occurred-at/);

    const mixedRestamp = await capture(() =>
      main([
        "incident",
        incId,
        "--recorded-at",
        "2026-08-17T21:00:00.000Z",
        "--clear-occurred-at",
        "--dir",
        dir,
      ]),
    );
    expect(mixedRestamp.code).toBe(1);
    expect(mixedRestamp.stderr).toMatch(/--recorded-at|--clear-occurred-at/);

    const mixedTitle = await capture(() =>
      main([
        "incident",
        incId,
        "--title",
        "Nope",
        "--clear-occurred-at",
        "--dir",
        dir,
      ]),
    );
    expect(mixedTitle.code).toBe(1);
    expect(mixedTitle.stderr).toMatch(/--title|--clear-occurred-at/);

    const mixedAppend = await capture(() =>
      main([
        "incident",
        incId,
        "--resolution",
        resC,
        "--clear-occurred-at",
        "--dir",
        dir,
      ]),
    );
    expect(mixedAppend.code).toBe(1);
    expect(mixedAppend.stderr).toMatch(/--resolution|--clear-occurred-at/);

    const mixedRemove = await capture(() =>
      main([
        "incident",
        incId,
        "--remove-resolution",
        resA,
        "--clear-occurred-at",
        "--dir",
        dir,
      ]),
    );
    expect(mixedRemove.code).toBe(1);
    expect(mixedRemove.stderr).toMatch(
      /--remove-resolution|--clear-occurred-at/,
    );

    const noPositional = await capture(() =>
      main(["incident", "--clear-occurred-at", "--dir", dir]),
    );
    expect(noPositional.code).toBe(1);
    expect(noPositional.stderr).toMatch(/--clear-occurred-at|Usage:/);

    const groupingSnapshots = await capture(() =>
      main([
        "incident",
        "--investigation",
        "inv:a",
        "--investigation",
        "inv:b",
        "--dir",
        dir,
      ]),
    );
    expect(groupingSnapshots.code).toBe(1);
    expect(groupingSnapshots.stderr).toContain(
      "--investigation takes one exact id",
    );

    const help = await capture(() => main(["help", "--all"]));
    expect(help.stdout).toContain("--clear-occurred-at");
    expect(help.stdout).toContain("incident inc:… --clear-occurred-at");

    const blankOccurred = await capture(() =>
      main(["incident", incId, "--occurred-at", "--dir", dir]),
    );
    expect(blankOccurred.code).toBe(1);
  });

  test("investigate and investigation reopen show retained snapshot history (Sprint 069)", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "sentry",
      providerResourceId: "hist069",
      kind: "project",
      name: "hist-sentry",
      metadata: { organization_slug: "acme" },
    });
    const other = createResource({
      provider: "github",
      providerResourceId: "hist069repo",
      kind: "repository",
      name: "acme/hist",
      metadata: {},
    });
    store.applyResource(project, {
      id: "obs-hist069",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.applyResource(other, {
      id: "obs-hist069-other",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.close();

    const emptyLive = await capture(() =>
      main(["investigate", project.id, "--dir", dir]),
    );
    expect(emptyLive.code).toBe(0);
    expect(emptyLive.stdout).toContain("SUBJECT");
    expect(emptyLive.stdout).not.toContain("INVESTIGATION HISTORY");
    expect(emptyLive.stdout).not.toContain(
      `No investigation snapshots saved for subject ${project.id}`,
    );

    const firstSave = await capture(() =>
      main(["investigate", project.id, "--save", "--dir", dir]),
    );
    expect(firstSave.code).toBe(0);
    expect(firstSave.stdout).toContain("INVESTIGATION HISTORY");
    expect(firstSave.stdout).toContain("Saved investigation snapshot inv:");
    const invA = firstSave.stdout.match(
      /Saved investigation snapshot (inv:\S+)/,
    )![1]!;
    expect(firstSave.stdout).toContain(invA);
    expect(firstSave.stdout).toContain("Retained compositions of this subject.");
    expect(firstSave.stdout).toContain("They are not an incident.");
    expect(firstSave.stdout.indexOf("INVESTIGATION HISTORY")).toBeLessThan(
      firstSave.stdout.indexOf("Saved investigation snapshot"),
    );

    const live = await capture(() =>
      main(["investigate", project.id, "--dir", dir]),
    );
    expect(live.code).toBe(0);
    expect(live.stdout).toContain("INVESTIGATION HISTORY");
    expect(live.stdout).toContain(invA);
    expect(live.stdout).not.toContain("INVESTIGATION SNAPSHOT");

    const otherSave = await capture(() =>
      main(["investigate", other.id, "--save", "--dir", dir]),
    );
    const otherInv = otherSave.stdout.match(
      /Saved investigation snapshot (inv:\S+)/,
    )![1]!;
    expect(otherSave.stdout).toContain("INVESTIGATION HISTORY");
    expect(otherSave.stdout).toContain(otherInv);
    expect(otherSave.stdout).not.toContain(invA);

    const secondSave = await capture(() =>
      main(["investigate", project.id, "--save", "--dir", dir]),
    );
    const invB = secondSave.stdout.match(
      /Saved investigation snapshot (inv:\S+)/,
    )![1]!;
    expect(secondSave.stdout).toContain("INVESTIGATION HISTORY");
    expect(secondSave.stdout).toContain(invA);
    expect(secondSave.stdout).toContain(invB);
    expect(secondSave.stdout).not.toContain(otherInv);

    const reopened = await capture(() =>
      main(["investigation", invA, "--dir", dir]),
    );
    expect(reopened.code).toBe(0);
    expect(reopened.stdout).toContain("INVESTIGATION SNAPSHOT");
    expect(reopened.stdout).toContain("INVESTIGATION HISTORY");
    expect(reopened.stdout).toContain(invA);
    expect(reopened.stdout).toContain(invB);
    expect(reopened.stdout).not.toContain(otherInv);
    expect(reopened.stdout).toContain(
      `Show: bun run combie investigation ${invB}`,
    );

    const listed = await capture(() =>
      main(["investigations", "--resource", project.id, "--dir", dir]),
    );
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain(invA);
    expect(listed.stdout).toContain(invB);
    expect(listed.stdout).toContain(project.id);
    expect(listed.stdout).not.toContain("INVESTIGATION HISTORY");
    expect(listed.stdout).not.toContain(
      `No investigation snapshots saved for subject ${project.id}`,
    );

    const knownEmpty = await capture(() =>
      main([
        "investigations",
        "--resource",
        "sentry:project:none",
        "--dir",
        dir,
      ]),
    );
    expect(knownEmpty.code).toBe(0);
    expect(knownEmpty.stdout).toContain(
      "No investigation snapshots saved for subject sentry:project:none",
    );

    const compared = await capture(() =>
      main(["investigation", invA, "--compare", "--dir", dir]),
    );
    expect(compared.code).toBe(0);
    expect(compared.stdout).toContain("INVESTIGATION COMPARE");
    expect(compared.stdout).not.toContain("INVESTIGATION HISTORY");

    const storeAfter = new Store(dir);
    storeAfter.init();
    const rowA = storeAfter.getInvestigationRow(invA);
    const rowB = storeAfter.getInvestigationRow(invB);
    storeAfter.close();
    expect(rowA?.snapshotJson).not.toContain("INVESTIGATION HISTORY");
    expect(rowB?.snapshotJson).not.toContain("INVESTIGATION HISTORY");
    expect(JSON.parse(rowA!.snapshotJson)).not.toHaveProperty(
      "investigationHistory",
    );

    const db = new Database(dbPath(dir));
    db.exec(`DELETE FROM resources WHERE id = '${project.id}'`);
    db.close();

    const missingSubject = await capture(() =>
      main(["investigate", project.id, "--dir", dir]),
    );
    expect(missingSubject.code).toBe(1);
    expect(missingSubject.stderr).toContain("Resource not found");
    expect(missingSubject.stdout).not.toContain("INVESTIGATION HISTORY");

    const reopenAfterDelete = await capture(() =>
      main(["investigation", invA, "--dir", dir]),
    );
    expect(reopenAfterDelete.code).toBe(0);
    expect(reopenAfterDelete.stdout).toContain("INVESTIGATION HISTORY");
    expect(reopenAfterDelete.stdout).toContain(invA);
    expect(reopenAfterDelete.stdout).toContain(invB);

    const leftover = await capture(() =>
      main([
        "incident",
        "--investigation",
        invA,
        "--investigation",
        invB,
        "--dir",
        dir,
      ]),
    );
    expect(leftover.code).toBe(1);
    expect(leftover.stderr).toContain("--investigation takes one exact id");

    const help = await capture(() => main(["help", "--all"]));
    expect(help.code).toBe(0);
    expect(help.stdout).toContain(
      "Investigation history appears on investigate and investigation reopen",
    );
    expect(help.stdout).toContain("when snapshots exist.");
  });

  test("investigate and investigation reopen show exact-id incident memory", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "sentry",
      providerResourceId: "inc059",
      kind: "project",
      name: "inc-recall-sentry",
      metadata: { organization_slug: "acme" },
    });
    const other = createResource({
      provider: "github",
      providerResourceId: "inc059repo",
      kind: "repository",
      name: "acme/inc-recall",
      metadata: {},
    });
    store.applyResource(project, {
      id: "obs-inc059",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.applyResource(other, {
      id: "obs-inc059-other",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.close();

    const saved = await capture(() =>
      main(["investigate", project.id, "--save", "--dir", dir]),
    );
    expect(saved.stdout).not.toContain("INCIDENT MEMORY");
    const invId = saved.stdout.match(/Saved investigation snapshot (inv:\S+)/)![1]!;

    const invRes = await capture(() =>
      main([
        "resolution",
        "--investigation",
        invId,
        "--decision",
        "Rollback 1.4.2",
        "--dir",
        dir,
      ]),
    );
    const resA = invRes.stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const otherRes = await capture(() =>
      main([
        "resolution",
        "--resource",
        other.id,
        "--decision",
        "Hold deploys",
        "--dir",
        dir,
      ]),
    );
    const resB = otherRes.stdout.match(/Recorded resolution (res:\S+)/)![1]!;

    const grouped = await capture(() =>
      main([
        "incident",
        "--resolution",
        resA,
        "--resolution",
        resB,
        "--title",
        "Cross spike",
        "--dir",
        dir,
      ]),
    );
    const incMixed = grouped.stdout.match(/Recorded incident (inc:\S+)/)![1]!;

    const liveA = await capture(() =>
      main(["investigate", project.id, "--dir", dir]),
    );
    expect(liveA.code).toBe(0);
    expect(liveA.stdout).toContain("RESOLUTION MEMORY");
    expect(liveA.stdout).toContain("INCIDENT MEMORY");
    expect(liveA.stdout.indexOf("RESOLUTION MEMORY")).toBeLessThan(
      liveA.stdout.indexOf("INCIDENT MEMORY"),
    );
    expect(liveA.stdout).toContain(incMixed);
    expect(liveA.stdout).toContain("Cross spike");
    expect(liveA.stdout).toContain(resA);
    expect(liveA.stdout).toContain(resB);
    expect(liveA.stdout).toContain("Rollback 1.4.2");
    expect(liveA.stdout).not.toContain("Hold deploys");
    expect(liveA.stdout).not.toMatch(/you should/i);
    expect(liveA.stdout).toContain(`incident ${incMixed}`);

    const liveB = await capture(() =>
      main(["investigate", other.id, "--dir", dir]),
    );
    expect(liveB.code).toBe(0);
    expect(liveB.stdout).toContain("INCIDENT MEMORY");
    expect(liveB.stdout).toContain(incMixed);
    expect(liveB.stdout).toContain("Hold deploys");
    expect(liveB.stdout).not.toContain("Rollback 1.4.2");

    const reopened = await capture(() =>
      main(["investigation", invId, "--dir", dir]),
    );
    expect(reopened.code).toBe(0);
    expect(reopened.stdout).toContain("INCIDENT MEMORY");
    expect(reopened.stdout).toContain(incMixed);
    expect(reopened.stdout).toContain("Cross spike");

    const onlyA = await capture(() =>
      main([
        "resolution",
        "--resource",
        project.id,
        "--decision",
        "Scale up",
        "--dir",
        dir,
      ]),
    );
    const resC = onlyA.stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const onlyB = await capture(() =>
      main([
        "resolution",
        "--resource",
        project.id,
        "--decision",
        "Scale down",
        "--dir",
        dir,
      ]),
    );
    const resD = onlyB.stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    const resourceOnly = await capture(() =>
      main([
        "incident",
        "--resolution",
        resC,
        "--resolution",
        resD,
        "--title",
        "Resource only",
        "--dir",
        dir,
      ]),
    );
    const incResource = resourceOnly.stdout.match(
      /Recorded incident (inc:\S+)/,
    )![1]!;

    const reopenAfter = await capture(() =>
      main(["investigation", invId, "--dir", dir]),
    );
    expect(reopenAfter.stdout).toContain(incMixed);
    expect(reopenAfter.stdout).not.toContain(incResource);
    expect(reopenAfter.stdout).not.toContain("Resource only");

    const liveAfter = await capture(() =>
      main(["investigate", project.id, "--dir", dir]),
    );
    expect(liveAfter.stdout).toContain(incMixed);
    expect(liveAfter.stdout).toContain(incResource);
    expect(liveAfter.stdout.indexOf(incResource)).toBeLessThan(
      liveAfter.stdout.indexOf(incMixed),
    );

    const compared = await capture(() =>
      main(["investigation", invId, "--compare", "--dir", dir]),
    );
    expect(compared.code).toBe(0);
    expect(compared.stdout).toContain("INVESTIGATION COMPARE");
    expect(compared.stdout).not.toContain("INCIDENT MEMORY");
    expect(compared.stdout).not.toContain(incMixed);

    const savedAgain = await capture(() =>
      main(["investigate", project.id, "--save", "--dir", dir]),
    );
    expect(savedAgain.code).toBe(0);
    expect(savedAgain.stdout).toContain("INCIDENT MEMORY");
    const inv2 = savedAgain.stdout.match(
      /Saved investigation snapshot (inv:\S+)/,
    )![1]!;
    const storeAfter = new Store(dir);
    storeAfter.init();
    const row = storeAfter.getInvestigationRow(inv2);
    expect(row?.snapshotJson).not.toContain("INCIDENT MEMORY");
    expect(row?.snapshotJson).not.toContain(incMixed);
    expect(row?.snapshotJson).not.toContain("Cross spike");
    storeAfter.close();

    const reopenSecond = await capture(() =>
      main(["investigation", inv2, "--dir", dir]),
    );
    expect(reopenSecond.stdout).not.toContain("INCIDENT MEMORY");

    const missingInv = await capture(() =>
      main(["investigation", "inv:missing", "--dir", dir]),
    );
    expect(missingInv.code).toBe(1);
    expect(missingInv.stdout).not.toContain("INCIDENT MEMORY");

    const missingResource = await capture(() =>
      main(["investigate", "sentry:project:nope", "--dir", dir]),
    );
    expect(missingResource.code).toBe(1);
    expect(missingResource.stdout).not.toContain("INCIDENT MEMORY");

    const help = await capture(() => main(["help", "--all"]));
    expect(help.stdout).toContain(
      "Incident memory appears on those same paths when groupings exist.",
    );
  });

  test("help --all lists the resolutions --evidence list line and example", async () => {
    const help = await capture(() => main(["help", "--all"]));
    expect(help.code).toBe(0);
    expect(help.stdout).toContain(
      `With "resolutions": list retained resolutions that attached that exact local id (membership only; one exact id)`,
    );
    expect(help.stdout).toContain("resolutions --evidence dpl_abc");
    expect(help.stdout).toContain(
      "Attach an exact local evidence id (optional, repeatable; never inferred)",
    );
  });

  test("investigate and investigation reopen show exact-id resolution memory", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "sentry",
      providerResourceId: "mem450",
      kind: "project",
      name: "mem-sentry",
      metadata: { organization_slug: "acme" },
    });
    const other = createResource({
      provider: "github",
      providerResourceId: "mem1001",
      kind: "repository",
      name: "acme/mem",
      metadata: {},
    });
    store.applyResource(project, {
      id: "obs-mem",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.applyResource(other, {
      id: "obs-mem-other",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    store.close();

    const saved = await capture(() =>
      main(["investigate", project.id, "--save", "--dir", dir]),
    );
    expect(saved.stdout).not.toContain("RESOLUTION MEMORY");
    const invId = saved.stdout.match(/Saved investigation snapshot (inv:\S+)/)![1]!;

    const emptyReopen = await capture(() =>
      main(["investigation", invId, "--dir", dir]),
    );
    expect(emptyReopen.code).toBe(0);
    expect(emptyReopen.stdout).toContain("INVESTIGATION SNAPSHOT");
    expect(emptyReopen.stdout).not.toContain("RESOLUTION MEMORY");

    const recorded = await capture(() =>
      main([
        "resolution",
        "--investigation",
        invId,
        "--decision",
        "Rollback 1.4.2",
        "--dir",
        dir,
      ]),
    );
    const resId = recorded.stdout.match(/Recorded resolution (res:\S+)/)![1]!;

    const reopened = await capture(() =>
      main(["investigation", invId, "--dir", dir]),
    );
    expect(reopened.code).toBe(0);
    expect(reopened.stdout).toContain("RESOLUTION MEMORY");
    expect(reopened.stdout).toContain(resId);
    expect(reopened.stdout).toContain("DECISION");
    expect(reopened.stdout).toContain("Rollback 1.4.2");
    expect(reopened.stdout).not.toMatch(/you should/i);

    const live = await capture(() =>
      main(["investigate", project.id, "--dir", dir]),
    );
    expect(live.code).toBe(0);
    expect(live.stdout).toContain("RESOLUTION MEMORY");
    expect(live.stdout).toContain(resId);
    expect(live.stdout).toContain(invId);
    expect(live.stdout).toContain("Rollback 1.4.2");

    const otherLive = await capture(() =>
      main(["investigate", other.id, "--dir", dir]),
    );
    expect(otherLive.code).toBe(0);
    expect(otherLive.stdout).not.toContain("RESOLUTION MEMORY");
    expect(otherLive.stdout).not.toContain(resId);

    const savedAgain = await capture(() =>
      main(["investigate", project.id, "--save", "--dir", dir]),
    );
    expect(savedAgain.code).toBe(0);
    expect(savedAgain.stdout).toContain("RESOLUTION MEMORY");
    expect(savedAgain.stdout).toContain(resId);
    expect(savedAgain.stdout).toContain("Rollback 1.4.2");
    const inv2 = savedAgain.stdout.match(
      /Saved investigation snapshot (inv:\S+)/,
    )![1]!;
    const storeAfter = new Store(dir);
    storeAfter.init();
    const row = storeAfter.getInvestigationRow(inv2);
    expect(row?.snapshotJson).not.toContain("RESOLUTION MEMORY");
    expect(row?.snapshotJson).not.toContain(resId);
    expect(row?.snapshotJson).not.toContain("Rollback 1.4.2");
    storeAfter.close();

    const reopenSecond = await capture(() =>
      main(["investigation", inv2, "--dir", dir]),
    );
    expect(reopenSecond.stdout).not.toContain("RESOLUTION MEMORY");

    const compared = await capture(() =>
      main(["investigation", invId, "--compare", "--dir", dir]),
    );
    expect(compared.code).toBe(0);
    expect(compared.stdout).toContain("INVESTIGATION COMPARE");
    expect(compared.stdout).not.toContain("RESOLUTION MEMORY");
    expect(compared.stdout).not.toContain(resId);

    const missingInv = await capture(() =>
      main(["investigation", "inv:missing", "--dir", dir]),
    );
    expect(missingInv.code).toBe(1);
    expect(missingInv.stderr).toContain("Investigation not found");
    expect(missingInv.stdout).not.toContain("RESOLUTION MEMORY");

    const missingResource = await capture(() =>
      main(["investigate", "sentry:project:nope", "--dir", dir]),
    );
    expect(missingResource.code).toBe(1);
    expect(missingResource.stdout).not.toContain("RESOLUTION MEMORY");
  });

  test("context renders empty, related-only, and history-only states", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.isInitialized();
    const empty = createResource({
      provider: "cloudflare",
      providerResourceId: "empty-context",
      kind: "zone",
      name: "empty.example",
      metadata: {},
    });
    const relatedOnly = createResource({
      provider: "github",
      providerResourceId: "related-context",
      kind: "repository",
      name: "related",
      metadata: { fullName: "acme/related" },
    });
    const neighbor = createResource({
      provider: "vercel",
      providerResourceId: "related-neighbor",
      kind: "project",
      name: "neighbor",
      metadata: {},
    });
    const historyOnly = createResource({
      provider: "sentry",
      providerResourceId: "history-context",
      kind: "project",
      name: "before",
      metadata: {},
    });
    for (const [resource, id] of [
      [empty, "empty-initial"],
      [relatedOnly, "related-initial"],
      [neighbor, "neighbor-initial"],
      [historyOnly, "history-initial"],
    ] as const) {
      store.applyResource(resource, {
        id,
        observedAt: "2026-08-08T08:00:00.000Z",
      });
    }
    store.upsertRelationship(
      createRelationship({
        sourceResourceId: relatedOnly.id,
        targetResourceId: neighbor.id,
        kind: "source_for",
        evidence: {
          source: "vercel",
          mechanism: "git_repository_reference",
          repository: "acme/related",
        },
      }),
    );
    store.applyResource(
      { ...historyOnly, name: "after" },
      { id: "history-change", observedAt: "2026-08-08T09:00:00.000Z" },
    );
    store.close();

    const emptyResult = await capture(() =>
      main(["context", empty.id, "--dir", dir]),
    );
    expect(emptyResult.code).toBe(0);
    expect(emptyResult.stdout).toContain("No relationships discovered yet.");
    expect(emptyResult.stdout).toContain("No changes recorded yet.");

    const relatedResult = await capture(() =>
      main(["context", relatedOnly.id, "--dir", dir]),
    );
    expect(relatedResult.code).toBe(0);
    expect(relatedResult.stdout).toContain("source_for →");
    expect(relatedResult.stdout).toContain(neighbor.id);
    expect(relatedResult.stdout).toContain("git_repository_reference");
    expect(relatedResult.stdout).toContain("No changes recorded yet.");

    const historyResult = await capture(() =>
      main(["context", historyOnly.id, "--dir", dir]),
    );
    expect(historyResult.code).toBe(0);
    expect(historyResult.stdout).toContain("No relationships discovered yet.");
    expect(historyResult.stdout).toContain("2026-08-08T09:00:00.000Z");
    expect(historyResult.stdout).toContain('"before" → "after"');
  });

  test("context composes both directions and target history offline without mutation", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.isInitialized();
    const repository = createResource({
      provider: "github",
      providerResourceId: "context-repository",
      kind: "repository",
      name: "web",
      metadata: { fullName: "acme/web" },
    });
    const project = createResource({
      provider: "vercel",
      providerResourceId: "context-project",
      kind: "project",
      name: "before",
      metadata: { domains: [], framework: "nextjs" },
    });
    const zone = createResource({
      provider: "cloudflare",
      providerResourceId: "context-zone",
      kind: "zone",
      name: "example.com",
      metadata: {},
    });
    for (const [resource, id] of [
      [repository, "repository-initial"],
      [project, "project-initial"],
      [zone, "zone-initial"],
    ] as const) {
      store.applyResource(resource, {
        id,
        observedAt: "2026-08-08T08:00:00.000Z",
      });
    }
    store.applyResource(
      { ...repository, name: "related-history-must-not-render" },
      {
        id: "related-history-sentinel",
        observedAt: "2026-08-08T11:00:00.000Z",
      },
    );
    store.applyResource(
      {
        ...project,
        name: "middle",
        metadata: { domains: ["preview.example.com"] },
      },
      { id: "older", observedAt: "2026-08-08T09:00:00.000Z" },
    );
    store.applyResource(
      {
        ...project,
        name: "current",
        metadata: { domains: ["app.example.com"], region: "iad1" },
      },
      { id: "newer", observedAt: "2026-08-08T10:00:00.000Z" },
    );
    store.upsertRelationship(
      createRelationship({
        sourceResourceId: repository.id,
        targetResourceId: project.id,
        kind: "source_for",
        evidence: {
          source: "vercel",
          mechanism: "git_repository_reference",
          repository: "acme/web",
        },
      }),
    );
    store.upsertRelationship(
      createRelationship({
        sourceResourceId: project.id,
        targetResourceId: zone.id,
        kind: "uses_domain_in",
        evidence: {
          source: "vercel",
          mechanism: "custom_domain_apex",
          apexName: "example.com",
          hostnames: ["app.example.com"],
        },
      }),
    );
    const providersBefore = store.listProviders();
    const resourcesBefore = store.listResources();
    const relationshipsBefore = store.listRelationships();
    const changesBefore = store.listChanges();
    store.close();

    const envKeys = [
      "CLOUDFLARE_API_TOKEN",
      "GITHUB_TOKEN",
      "GH_TOKEN",
      "VERCEL_TOKEN",
      "SENTRY_AUTH_TOKEN",
    ] as const;
    const previousEnv = new Map(
      envKeys.map((key) => [key, process.env[key]] as const),
    );
    for (const key of envKeys) delete process.env[key];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("context must not call a provider");
    }) as unknown as typeof fetch;
    let first;
    let second;
    try {
      first = await capture(() =>
        main(["context", project.id, "--dir", dir]),
      );
      second = await capture(() =>
        main(["context", project.id, "--dir", dir]),
      );
    } finally {
      globalThis.fetch = originalFetch;
      for (const key of envKeys) {
        const value = previousEnv.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    expect(first.code).toBe(0);
    expect(second).toEqual(first);
    expect(first.stdout).toContain("Vercel project: current");
    expect(first.stdout).toContain("← source_for");
    expect(first.stdout).toContain(repository.id);
    expect(first.stdout).toContain("uses_domain_in →");
    expect(first.stdout).toContain(zone.id);
    expect(first.stdout).toContain("custom_domain_apex");
    expect(first.stdout).toContain('hostnames=["app.example.com"]');
    expect(first.stdout).toContain("2026-08-08T10:00:00.000Z");
    expect(first.stdout).toContain("2026-08-08T09:00:00.000Z");
    expect(first.stdout.match(/Observed:/g)).toHaveLength(2);
    expect(first.stdout.indexOf("2026-08-08T10:00:00.000Z")).toBeLessThan(
      first.stdout.indexOf("2026-08-08T09:00:00.000Z"),
    );
    expect(first.stdout).toContain(
      '["preview.example.com"] → ["app.example.com"]',
    );
    expect(first.stdout).toContain("(absent) → \"iad1\"");
    expect(first.stdout).not.toContain("related-history-must-not-render");
    expect(first.stdout).not.toContain("related-history-sentinel");

    const reopened = new Store(dir);
    reopened.isInitialized();
    expect(reopened.listProviders()).toEqual(providersBefore);
    expect(reopened.listResources()).toEqual(resourcesBefore);
    expect(reopened.listRelationships()).toEqual(relationshipsBefore);
    expect(reopened.listChanges()).toEqual(changesBefore);
    reopened.close();
  });

  test("relationships empty state after init", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const result = await capture(() => main(["relationships", "--dir", dir]));
    expect(result.code).toBe(0);
    expect(result.stdout.toLowerCase()).toMatch(/no relationships|sync/);
  });

  test("help --all lists relationships command", async () => {
    const result = await capture(() => main(["help", "--all"]));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("relationships");
  });

  test("related fails when not initialized", async () => {
    const result = await capture(() =>
      main(["related", "github:repository:1", "--dir", dir]),
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("combie init");
  });

  test("related requires resource id", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const result = await capture(() => main(["related", "--dir", dir]));
    expect(result.code).not.toBe(0);
    expect(result.stderr.toLowerCase()).toMatch(/usage|resource/);
  });

  test("related not-found state", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const result = await capture(() =>
      main(["related", "github:repository:does-not-exist", "--dir", dir]),
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Resource not found");
    expect(result.stderr).toContain("combie resources");
  });

  test("help --all lists related command", async () => {
    const result = await capture(() => main(["help", "--all"]));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("related");
    expect(result.stdout).toContain("provider:kind:providerResourceId");
  });

  test("related shows source and target directions with evidence", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.isInitialized();
    const gh = createResource({
      provider: "github",
      providerResourceId: "1001",
      kind: "repository",
      name: "demo-hub",
      metadata: { fullName: "acme/demo-hub" },
    });
    const vc = createResource({
      provider: "vercel",
      providerResourceId: "prj_demo",
      kind: "project",
      name: "demo-hub",
      metadata: {},
    });
    store.upsertResource(gh);
    store.upsertResource(vc);
    store.upsertRelationship(
      createRelationship({
        sourceResourceId: gh.id,
        targetResourceId: vc.id,
        kind: "source_for",
        evidence: {
          source: "vercel",
          mechanism: "git_repository_reference",
          repository: "acme/demo-hub",
        },
      }),
    );
    store.close();

    const fromSource = await capture(() =>
      main(["related", gh.id, "--dir", dir]),
    );
    expect(fromSource.code).toBe(0);
    expect(fromSource.stdout).toContain("source_for →");
    expect(fromSource.stdout).toContain("Vercel project");
    expect(fromSource.stdout).toContain("Evidence:");
    expect(fromSource.stdout).toContain("git_repository_reference");
    expect(fromSource.stdout).not.toContain("secret");

    const fromTarget = await capture(() =>
      main(["related", vc.id, "--dir", dir]),
    );
    expect(fromTarget.code).toBe(0);
    expect(fromTarget.stdout).toContain("← source_for");
    expect(fromTarget.stdout).toContain("GitHub repository");
    expect(fromTarget.stdout).toContain("acme/demo-hub");
  });

  test("relationships and related render uses_domain_in both ways", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.isInitialized();
    const vc = createResource({
      provider: "vercel",
      providerResourceId: "prj_web",
      kind: "project",
      name: "web",
      metadata: {},
    });
    const zone = createResource({
      provider: "cloudflare",
      providerResourceId: "zone-1",
      kind: "zone",
      name: "example.com",
      metadata: {},
    });
    const gh = createResource({
      provider: "github",
      providerResourceId: "1001",
      kind: "repository",
      name: "web",
      metadata: { fullName: "acme/web" },
    });
    store.upsertResource(vc);
    store.upsertResource(zone);
    store.upsertResource(gh);
    store.upsertRelationship(
      createRelationship({
        sourceResourceId: vc.id,
        targetResourceId: zone.id,
        kind: "uses_domain_in",
        evidence: {
          source: "vercel",
          mechanism: "custom_domain_apex",
          apexName: "example.com",
          hostnames: ["app.example.com"],
        },
      }),
    );
    store.upsertRelationship(
      createRelationship({
        sourceResourceId: gh.id,
        targetResourceId: vc.id,
        kind: "source_for",
        evidence: {
          source: "vercel",
          mechanism: "git_repository_reference",
          repository: "acme/web",
        },
      }),
    );
    store.close();

    const rels = await capture(() => main(["relationships", "--dir", dir]));
    expect(rels.code).toBe(0);
    expect(rels.stdout).toContain("uses_domain_in");
    expect(rels.stdout).toContain("source_for");
    expect(rels.stdout).toContain("Vercel web");
    expect(rels.stdout).toContain("Cloudflare example.com");
    expect(rels.stdout).toContain("example.com");

    const fromProject = await capture(() =>
      main(["related", vc.id, "--dir", dir]),
    );
    expect(fromProject.code).toBe(0);
    expect(fromProject.stdout).toContain("uses_domain_in →");
    expect(fromProject.stdout).toContain("Cloudflare zone");
    expect(fromProject.stdout).toContain("← source_for");

    const fromZone = await capture(() =>
      main(["related", zone.id, "--dir", dir]),
    );
    expect(fromZone.code).toBe(0);
    expect(fromZone.stdout).toContain("← uses_domain_in");
    expect(fromZone.stdout).toContain("Vercel project");
    expect(fromZone.stdout).toContain("custom_domain_apex");
    expect(fromZone.stdout).not.toContain("secret");
  });

  test("formatRelationshipsTable shows uses_domain_in apex evidence", () => {
    const rel = createRelationship({
      sourceResourceId: "vercel:project:prj_web",
      targetResourceId: "cloudflare:zone:zone-1",
      kind: "uses_domain_in",
      evidence: {
        source: "vercel",
        mechanism: "custom_domain_apex",
        apexName: "example.com",
        hostnames: ["app.example.com"],
      },
    });
    const labels = new Map<string, ResourceLabel>([
      [
        "vercel:project:prj_web",
        { provider: "vercel", name: "web", kind: "project", displayName: "web" },
      ],
      [
        "cloudflare:zone:zone-1",
        {
          provider: "cloudflare",
          name: "example.com",
          kind: "zone",
          displayName: "example.com",
        },
      ],
    ]);
    const table = formatRelationshipsTable([rel], labels);
    expect(table).toContain("uses_domain_in");
    expect(table).toContain("Vercel web");
    expect(table).toContain("Cloudflare example.com");
    expect(table).toContain("example.com");
  });

  test("formatRelationshipsTable shows source kind target and evidence", () => {
    const rel = createRelationship({
      sourceResourceId: "github:repository:1001",
      targetResourceId: "vercel:project:prj_abc",
      kind: "source_for",
      evidence: {
        source: "vercel",
        mechanism: "git_repository_reference",
        repository: "acme/combie",
        githubRepoId: "1001",
      },
    });
    const labels = new Map<string, ResourceLabel>([
      [
        "github:repository:1001",
        {
          provider: "github",
          name: "combie",
          kind: "repository",
          displayName: "acme/combie",
        },
      ],
      [
        "vercel:project:prj_abc",
        {
          provider: "vercel",
          name: "combie-web",
          kind: "project",
          displayName: "combie-web",
        },
      ],
    ]);
    const table = formatRelationshipsTable([rel], labels);
    expect(table).toContain("FROM");
    expect(table).toContain("RELATIONSHIP");
    expect(table).toContain("TO");
    expect(table).toContain("EVIDENCE");
    expect(table).not.toContain("last verified");
    expect(table).toContain("GitHub acme/combie");
    expect(table).toContain("source_for");
    expect(table).toContain("Vercel combie-web");
    expect(table).toContain("acme/combie");
    expect(table).not.toContain("ghp_");
    expect(table).not.toContain("secret");
  });

  test("formatResourcesTable stays identity-only (Sprint 085)", () => {
    const resource = createResource({
      provider: "github",
      providerResourceId: "085-resources",
      kind: "repository",
      name: "combie",
      metadata: {},
    });
    const table = formatResourcesTable([resource]);
    expect(table).toContain("TYPE");
    expect(table).toContain("NAME");
    expect(table).toContain("ID");
    expect(table).toContain("PROVIDER");
    expect(table).not.toContain("last successful discovery");
  });

  test("connect does not leak token on auth failure", async () => {
    await capture(() => main(["init", "--dir", dir]));
    const secret = "super-secret-token-value-xyz";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 9109, message: "Invalid access token" }],
          messages: [],
          result: null,
        }),
        { status: 401 },
      );
    }) as unknown as typeof fetch;

    try {
      const result = await capture(() =>
        main(["connect", "cloudflare", "--token", secret, "--dir", dir]),
      );
      expect(result.code).not.toBe(0);
      expect(result.stderr).not.toContain(secret);
      expect(result.stdout).not.toContain(secret);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
