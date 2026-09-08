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

describe("CLI structured response memory", () => {
  let dir: string;
  let projectId: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "combie-cli-srm-"));
    await capture(() => main(["init", "--dir", dir]));
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "vercel",
      providerResourceId: "prj_srm111",
      kind: "project",
      name: "srm-project",
      metadata: {},
    });
    store.applyResource(project, {
      id: "obs-srm111",
      observedAt: "2026-08-26T00:00:00.000Z",
    });
    projectId = project.id;
    store.close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("help --all lists the eight commands and new flags", async () => {
    const help = await capture(() => main(["help", "--all"]));
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("recommendation");
    expect(help.stdout).toContain("recommendations");
    expect(help.stdout).toContain("decision");
    expect(help.stdout).toContain("decisions");
    expect(help.stdout).toContain("action");
    expect(help.stdout).toContain("actions");
    expect(help.stdout).toContain("outcome");
    expect(help.stdout).toContain("outcomes");
    expect(help.stdout).toContain("--action-key");
    expect(help.stdout).toContain("--proposal");
    expect(help.stdout).toContain("--disposition");
    expect(help.stdout).toContain("--assessment");
    expect(help.stdout).toContain("--metric");
    expect(help.stdout).toContain("--decision <text>");
    expect(help.stdout).toContain("--action <text>");
  });

  test("--json is rejected on the new record/show commands", async () => {
    for (const command of ["recommendation", "decision", "action", "outcome"]) {
      const result = await capture(() =>
        main([command, "--json", "--dir", dir]),
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("only available for");
    }
  });

  test("--task on recommendation is rejected", async () => {
    const result = await capture(() =>
      main(["recommendation", "--task", "response-recall", "--dir", dir]),
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--task is only available with investigate");
  });

  test("records, shows, and lists a resource-anchored recommendation", async () => {
    const recorded = await capture(() =>
      main([
        "recommendation",
        "--resource",
        projectId,
        "--action-key",
        "rollback-deployment",
        "--proposal",
        "Rollback the latest deployment",
        "--dir",
        dir,
      ]),
    );
    expect(recorded.code).toBe(0);
    expect(recorded.stdout).toContain("Recorded recommendation rec:");
    expect(recorded.stdout).toContain(projectId);
    const recMatch = recorded.stdout.match(/Recorded recommendation (rec:\S+)/);
    expect(recMatch).not.toBeNull();
    const recId = recMatch![1]!;

    const shown = await capture(() =>
      main(["recommendation", recId, "--dir", dir]),
    );
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain("RECOMMENDATION");
    expect(shown.stdout).toContain("ACTION KEY");
    expect(shown.stdout).toContain("rollback-deployment");
    expect(shown.stdout).toContain("PROPOSAL");
    expect(shown.stdout).toContain("Rollback the latest deployment");

    const listed = await capture(() =>
      main(["recommendations", "--resource", projectId, "--dir", dir]),
    );
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain(recId);

    const empty = await capture(() =>
      main([
        "recommendations",
        "--resource",
        "github:repository:999999",
        "--dir",
        dir,
      ]),
    );
    expect(empty.code).toBe(0);
    expect(empty.stdout).toContain("This is known-empty");
  });

  test("records decision, action, and outcome through the CLI chain", async () => {
    const rec = await capture(() =>
      main([
        "recommendation",
        "--resource",
        projectId,
        "--action-key",
        "rollback-deployment",
        "--proposal",
        "Rollback the latest deployment",
        "--dir",
        dir,
      ]),
    );
    const recId = rec.stdout.match(/Recorded recommendation (rec:\S+)/)![1]!;

    const decided = await capture(() =>
      main([
        "decision",
        "--recommendation",
        recId,
        "--disposition",
        "approved",
        "--dir",
        dir,
      ]),
    );
    expect(decided.code).toBe(0);
    const decId = decided.stdout.match(/Recorded decision (dec:\S+)/)![1]!;

    const shownDecision = await capture(() =>
      main(["decision", decId, "--dir", dir]),
    );
    expect(shownDecision.code).toBe(0);
    expect(shownDecision.stdout).toContain("DECISION");
    expect(shownDecision.stdout).toContain("DISPOSITION");
    expect(shownDecision.stdout).toContain("approved");

    const acted = await capture(() =>
      main([
        "action",
        "--decision",
        decId,
        "--action-key",
        "rollback-deployment",
        "--summary",
        "Rolled back dpl_abc",
        "--dir",
        dir,
      ]),
    );
    expect(acted.code).toBe(0);
    const actId = acted.stdout.match(/Recorded action (act:\S+)/)![1]!;

    const shownAction = await capture(() =>
      main(["action", actId, "--dir", dir]),
    );
    expect(shownAction.code).toBe(0);
    expect(shownAction.stdout).toContain("ACTION");
    expect(shownAction.stdout).toContain("rollback-deployment");
    expect(shownAction.stdout).toContain("Rolled back dpl_abc");

    const assessed = await capture(() =>
      main([
        "outcome",
        "--action",
        actId,
        "--assessment",
        "positive",
        "--summary",
        "Error rate returned toward baseline",
        "--dir",
        dir,
      ]),
    );
    expect(assessed.code).toBe(0);
    const outId = assessed.stdout.match(/Recorded outcome (out:\S+)/)![1]!;

    const shownOutcome = await capture(() =>
      main(["outcome", outId, "--dir", dir]),
    );
    expect(shownOutcome.code).toBe(0);
    expect(shownOutcome.stdout).toContain("OUTCOME");
    expect(shownOutcome.stdout).toContain("positive");
    expect(shownOutcome.stdout).toContain("Error rate returned toward baseline");
  });

  test("outcome measurement is atomic and shown as a MEASUREMENT block", async () => {
    const rec = await capture(() =>
      main([
        "recommendation",
        "--resource",
        projectId,
        "--action-key",
        "rollback-deployment",
        "--proposal",
        "Rollback the latest deployment",
        "--dir",
        dir,
      ]),
    );
    const recId = rec.stdout.match(/Recorded recommendation (rec:\S+)/)![1]!;
    const decided = await capture(() =>
      main([
        "decision",
        "--recommendation",
        recId,
        "--disposition",
        "approved",
        "--dir",
        dir,
      ]),
    );
    const decId = decided.stdout.match(/Recorded decision (dec:\S+)/)![1]!;
    const acted = await capture(() =>
      main([
        "action",
        "--decision",
        decId,
        "--action-key",
        "rollback-deployment",
        "--summary",
        "Rolled back dpl_abc",
        "--dir",
        dir,
      ]),
    );
    const actId = acted.stdout.match(/Recorded action (act:\S+)/)![1]!;

    const assessed = await capture(() =>
      main([
        "outcome",
        "--action",
        actId,
        "--assessment",
        "positive",
        "--summary",
        "Error rate dropped",
        "--metric",
        "error-rate",
        "--before",
        "12.4",
        "--after",
        "1.1",
        "--unit",
        "percent",
        "--dir",
        dir,
      ]),
    );
    expect(assessed.code).toBe(0);
    const outId = assessed.stdout.match(/Recorded outcome (out:\S+)/)![1]!;
    const shown = await capture(() => main(["outcome", outId, "--dir", dir]));
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain("MEASUREMENT");
    expect(shown.stdout).toContain("error-rate");
    expect(shown.stdout).toContain("12.4");
    expect(shown.stdout).toContain("1.1");
    expect(shown.stdout).toContain("percent");

    const partial = await capture(() =>
      main([
        "outcome",
        "--action",
        actId,
        "--assessment",
        "positive",
        "--summary",
        "Incomplete measurement",
        "--metric",
        "error-rate",
        "--dir",
        dir,
      ]),
    );
    expect(partial.code).toBe(1);
    expect(partial.stderr).toContain("measurement");
    expect(partial.stderr).toContain("together");

    const metricOnly = await capture(() =>
      main(["outcome", "--metric", "error-rate", "--dir", dir]),
    );
    expect(metricOnly.code).toBe(1);
    expect(metricOnly.stderr).toContain("measurement");
    expect(metricOnly.stderr).toContain("together");
  });

  test("rejected or deferred decisions cannot receive an action", async () => {
    const rec = await capture(() =>
      main([
        "recommendation",
        "--resource",
        projectId,
        "--action-key",
        "rollback-deployment",
        "--proposal",
        "Rollback the latest deployment",
        "--dir",
        dir,
      ]),
    );
    const recId = rec.stdout.match(/Recorded recommendation (rec:\S+)/)![1]!;
    const rejected = await capture(() =>
      main([
        "decision",
        "--recommendation",
        recId,
        "--disposition",
        "rejected",
        "--dir",
        dir,
      ]),
    );
    const decId = rejected.stdout.match(/Recorded decision (dec:\S+)/)![1]!;

    const acted = await capture(() =>
      main([
        "action",
        "--decision",
        decId,
        "--action-key",
        "rollback-deployment",
        "--summary",
        "Should not record",
        "--dir",
        dir,
      ]),
    );
    expect(acted.code).toBe(1);
    expect(acted.stderr).toContain("approved or modified");
  });

  test("recommendation --investigation + --resource is an anchor conflict", async () => {
    const result = await capture(() =>
      main([
        "recommendation",
        "--investigation",
        "inv:missing",
        "--resource",
        projectId,
        "--action-key",
        "rollback-deployment",
        "--proposal",
        "Rollback",
        "--dir",
        dir,
      ]),
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("exactly one");
  });

  test("invalid --action-key is rejected", async () => {
    const result = await capture(() =>
      main([
        "recommendation",
        "--resource",
        projectId,
        "--action-key",
        "Rollback_Deploy",
        "--proposal",
        "Rollback",
        "--dir",
        dir,
      ]),
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--action-key");
    expect(result.stderr).toContain("lower-kebab");
  });

  test("modified decision without --note is rejected", async () => {
    const rec = await capture(() =>
      main([
        "recommendation",
        "--resource",
        projectId,
        "--action-key",
        "rollback-deployment",
        "--proposal",
        "Rollback the latest deployment",
        "--dir",
        dir,
      ]),
    );
    const recId = rec.stdout.match(/Recorded recommendation (rec:\S+)/)![1]!;
    const result = await capture(() =>
      main([
        "decision",
        "--recommendation",
        recId,
        "--disposition",
        "modified",
        "--dir",
        dir,
      ]),
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("modified decision requires --note");
  });

  test("unknown show ids fail with *_NOT_FOUND", async () => {
    const result = await capture(() =>
      main(["recommendation", "rec:missing", "--dir", dir]),
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("not found");
    expect(result.stderr).toContain("rec:missing");
  });

  test("recommendation with no args lists known-empty", async () => {
    const result = await capture(() => main(["recommendation", "--dir", dir]));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("No recommendations recorded yet.");
  });

  test("incident-anchored recommendation records against a named member subject", async () => {
    const resA = await capture(() =>
      main([
        "resolution",
        "--resource",
        projectId,
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
        projectId,
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
        "--dir",
        dir,
      ]),
    );
    expect(grouped.code).toBe(0);
    const incId = grouped.stdout.match(/Recorded incident (inc:\S+)/)![1]!;

    const recorded = await capture(() =>
      main([
        "recommendation",
        "--incident",
        incId,
        "--resource",
        projectId,
        "--action-key",
        "hold-deploys",
        "--proposal",
        "Hold deploys",
        "--dir",
        dir,
      ]),
    );
    expect(recorded.code).toBe(0);
    expect(recorded.stdout).toContain("Recorded recommendation rec:");
    const recId = recorded.stdout.match(/Recorded recommendation (rec:\S+)/)![1]!;

    const shown = await capture(() =>
      main(["recommendation", recId, "--dir", dir]),
    );
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain("INCIDENT");
    expect(shown.stdout).toContain(incId);
  });
});
