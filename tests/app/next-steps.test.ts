import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectProvider } from "../../src/app/connect.ts";
import { initCombie } from "../../src/app/init.ts";
import {
  buildConnectNextSteps,
  buildInvestigateNextSteps,
  buildSyncNextSteps,
  formatNextStepsBlock,
} from "../../src/app/next-steps.ts";
import { syncProviders } from "../../src/app/sync.ts";
import { createRelationship } from "../../src/domain/relationship.ts";
import { createResource } from "../../src/domain/resource.ts";
import { BINARY_NAME } from "../../src/cli/constants.ts";
import { Store } from "../../src/storage/store.ts";

function mockGitHubFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.endsWith("/user") || (url.includes("/user") && !url.includes("/repos"))) {
      return Response.json({ login: "octocat", id: 1 });
    }
    if (url.includes("/user/repos") || url.includes("/repos")) {
      return Response.json([
        {
          id: 1,
          name: "demo-hub",
          full_name: "octocat/demo-hub",
          updated_at: "2026-01-01T00:00:00Z",
          private: false,
        },
      ]);
    }
    if (url.includes("/actions/runs")) {
      return Response.json({ workflow_runs: [], total_count: 0 });
    }
    return Response.json({}, { status: 404 });
  }) as typeof fetch;
}

describe("next steps", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "combie-next-steps-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("formatNextStepsBlock renders required and optional steps distinctly", () => {
    const block = formatNextStepsBlock([
      { label: "Discover resources", command: "combie sync" },
      {
        label: "Connect Vercel for cross-provider relationships",
        command: "combie connect vercel --use-env",
        optional: true,
      },
    ]);
    expect(block).toContain("Next steps:");
    expect(block).toContain("Discover resources:");
    expect(block).toContain("combie sync");
    expect(block).toContain("(Optional) Connect Vercel");
    expect(block).toContain("combie connect vercel --use-env");
  });

  test("connect github suggests sync plus optional vercel and agent setup", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockGitHubFetch();
    try {
      initCombie(dir);
      const connected = await connectProvider({
        baseDir: dir,
        providerId: "github",
        token: "gh-token",
      });

      expect(connected.message).toContain("Next steps:");
      expect(connected.message).toContain("Discover repositories and workflow runs");
      expect(connected.message).toContain("combie sync");
      expect(connected.message).toContain("(Optional) Connect Vercel");
      expect(connected.message).not.toContain("Next: combie sync");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("sync with github repos and no relationships suggests optional vercel connect", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockGitHubFetch();
    try {
      initCombie(dir);
      await connectProvider({
        baseDir: dir,
        providerId: "github",
        token: "gh-token",
      });
      const sync = await syncProviders({ baseDir: dir });
      expect(sync.message).toContain("Next steps:");
      expect(sync.message).toContain("Browse discovered resources");
      expect(sync.message).toContain("(Optional) Connect Vercel");
      expect(sync.message).toContain("GitHub ↔ deployment relationships");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("sync does not suggest vercel when relationships already exist", () => {
    initCombie(dir);
    const store = new Store(dir);
    store.init();
    store.upsertProvider({
      id: "github",
      name: "GitHub",
      status: "connected",
      lastSyncAt: null,
      config: { accountId: "1", accountName: "octocat" },
    });
    store.upsertResource(
      createResource({
        provider: "github",
        providerResourceId: "1",
        kind: "repository",
        name: "demo-hub",
        metadata: {},
      }),
    );
    store.upsertRelationship(
      createRelationship({
        sourceResourceId: "github:repository:1",
        targetResourceId: "vercel:project:prj_1",
        kind: "source_for",
        evidence: {
          source: "vercel",
          mechanism: "git_repository_reference",
          repository: "octocat/demo-hub",
        },
      }),
    );
    store.close();

    const steps = buildSyncNextSteps(dir, {
      results: [{ providerId: "github", ok: true }],
      ok: true,
      totalResources: 1,
    });
    expect(steps.some((step) => step.command.includes("connect vercel"))).toBe(
      false,
    );
  });

  test("investigate next steps appear only before the first saved snapshot", () => {
    initCombie(dir);
    const subjectId = "github:repository:1";
    expect(buildInvestigateNextSteps(dir, subjectId)).toEqual([
      {
        label: "Retain this composition for later comparison",
        command: `${BINARY_NAME} investigate ${subjectId} --save`,
      },
      {
        label: "Configure MCP access for your coding agent",
        command: `${BINARY_NAME} agent setup`,
        optional: true,
      },
    ]);

    const store = new Store(dir);
    store.init();
    store.insertInvestigation({
      id: "inv:1",
      subjectResourceId: subjectId,
      composedAt: "2026-01-01T00:00:00Z",
      snapshotJson: "{}",
    });
    store.close();

    expect(buildInvestigateNextSteps(dir, subjectId)).toEqual([]);
  });

  test("connect vercel omits optional vercel step", () => {
    initCombie(dir);
    const store = new Store(dir);
    store.init();
    store.upsertProvider({
      id: "vercel",
      name: "Vercel",
      status: "connected",
      lastSyncAt: null,
      config: { accountId: "1", accountName: "test-user" },
    });
    store.close();

    const steps = buildConnectNextSteps(dir, "vercel");
    expect(steps[0]?.command).toBe(`${BINARY_NAME} sync`);
    expect(steps[0]?.label).toBe("Discover projects and deployment evidence");
    expect(steps.some((step) => step.command.includes("connect vercel"))).toBe(
      false,
    );
  });
});
