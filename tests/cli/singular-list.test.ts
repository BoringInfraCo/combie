import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../src/cli/index.ts";
import { createResource } from "../../src/domain/resource.ts";
import { Store } from "../../src/storage/store.ts";

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

describe("CLI singular commands list when no id", () => {
  let dir: string;
  let projectId: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "combie-cli-singular-list-"));
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "sentry",
      providerResourceId: "singular-list",
      kind: "project",
      name: "singular-list-sentry",
      metadata: { organization_slug: "acme" },
    });
    store.applyResource(project, {
      id: "obs-singular-list",
      observedAt: "2026-08-16T00:00:00.000Z",
    });
    projectId = project.id;
    store.close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("investigation lists and --json matches investigations", async () => {
    const listed = await capture(() => main(["investigation", "--dir", dir]));
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("No investigation snapshots saved yet.");

    const plural = await capture(() => main(["investigations", "--dir", dir]));
    expect(plural.stdout).toBe(listed.stdout);

    const json = await capture(() =>
      main(["investigation", "--json", "--dir", dir]),
    );
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({ investigations: [] });
  });

  test("resolution lists; --resource without fields lists; --incident without fields still records", async () => {
    const listed = await capture(() => main(["resolution", "--dir", dir]));
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("No resolutions recorded yet.");

    const byResource = await capture(() =>
      main(["resolution", "--resource", projectId, "--dir", dir]),
    );
    expect(byResource.code).toBe(0);
    expect(byResource.stdout).toContain(
      `No resolutions recorded for subject ${projectId}.`,
    );

    const incidentRecord = await capture(() =>
      main(["resolution", "--incident", "inc:missing", "--dir", dir]),
    );
    expect(incidentRecord.code).toBe(1);
    expect(incidentRecord.stderr).toContain("At least one of --decision");
    expect(incidentRecord.stdout).not.toContain("No resolutions recorded");
  });

  test("incident lists; --resource lists; --resolution still creates", async () => {
    const listed = await capture(() => main(["incident", "--dir", dir]));
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("No incidents recorded yet.");

    const byResource = await capture(() =>
      main(["incident", "--resource", projectId, "--dir", dir]),
    );
    expect(byResource.code).toBe(0);
    expect(byResource.stdout).toContain(
      `No incidents recorded for subject ${projectId}.`,
    );

    const create = await capture(() =>
      main(["incident", "--resolution", "res:only-one", "--dir", dir]),
    );
    expect(create.code).toBe(1);
    expect(create.stderr).toMatch(/resolution/i);
    expect(create.stdout).not.toContain("No incidents recorded");
  });

  test("recommendation, decision, action, outcome, and incident-link list", async () => {
    for (const [command, empty] of [
      ["recommendation", "No recommendations recorded yet."],
      ["decision", "No decisions recorded yet."],
      ["action", "No actions recorded yet."],
      ["outcome", "No outcomes recorded yet."],
      ["incident-link", "No incident links recorded yet."],
    ] as const) {
      const result = await capture(() => main([command, "--dir", dir]));
      expect(result.code).toBe(0);
      expect(result.stdout).toContain(empty);
    }
  });

  test("decision --recommendation without disposition lists", async () => {
    const result = await capture(() =>
      main(["decision", "--recommendation", "rec:missing", "--dir", dir]),
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      "No decisions recorded for recommendation rec:missing.",
    );
  });

  test("incident-link --incident without --reason lists", async () => {
    const result = await capture(() =>
      main(["incident-link", "--incident", "inc:missing", "--dir", dir]),
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      "No incident links recorded for incident inc:missing.",
    );
  });
});
