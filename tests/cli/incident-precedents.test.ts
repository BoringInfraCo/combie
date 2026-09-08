import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../src/cli/index.ts";
import { createResource } from "../../src/domain/resource.ts";
import {
  projectIncidentPrecedentSet,
  toIncidentPrecedentMemory,
} from "../../src/mcp/projections.ts";
import { composeIncidentPrecedents } from "../../src/app/incident-precedents.ts";
import { recordIncidentLink } from "../../src/app/incident-links.ts";
import { recordIncident } from "../../src/app/incidents.ts";
import { recordResolution } from "../../src/app/resolutions.ts";
import {
  recordAction,
  recordDecision,
  recordOutcome,
  recordRecommendation,
} from "../../src/app/structured-response-memory.ts";
import { safeJson } from "../../src/mcp/serialization.ts";
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

async function seedQueryIncident(dir: string): Promise<string> {
  const store = new Store(dir);
  store.init();
  const project = createResource({
    provider: "vercel",
    providerResourceId: "prj_precedent_cli",
    kind: "project",
    name: "precedent-cli-project",
    metadata: {},
  });
  store.applyResource(project, {
    id: "obs-precedent-cli",
    observedAt: "2026-08-26T00:00:00.000Z",
  });
  store.close();

  const r1 = await capture(() =>
    main([
      "resolution",
      "--resource",
      project.id,
      "--decision",
      "Hold",
      "--dir",
      dir,
    ]),
  );
  const r2 = await capture(() =>
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
  const res1 = r1.stdout.match(/Recorded resolution (res:\S+)/)![1]!;
  const res2 = r2.stdout.match(/Recorded resolution (res:\S+)/)![1]!;
  const inc = await capture(() =>
    main([
      "incident",
      "--resolution",
      res1,
      "--resolution",
      res2,
      "--title",
      "Query spike",
      "--dir",
      dir,
    ]),
  );
  return inc.stdout.match(/Recorded incident (inc:\S+)/)![1]!;
}

describe("CLI precedents", () => {
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "combie-cli-precedents-"));
    await capture(() => main(["init", "--dir", dir]));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("help --all lists precedents and JSON allowlist includes only precedents among new commands", async () => {
    const help = await capture(() => main(["help", "--all"]));
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("precedents");

    const rejectedLink = await capture(() =>
      main(["incident-link", "--json", "--dir", dir]),
    );
    expect(rejectedLink.code).toBe(1);
    expect(rejectedLink.stderr).toContain("precedents");
    expect(rejectedLink.stderr).toContain("only available for");

    const rejectedUnrelated = await capture(() =>
      main(["relationships", "--json", "--dir", dir]),
    );
    expect(rejectedUnrelated.code).toBe(1);
    expect(rejectedUnrelated.stderr).toContain("only available for");
  });

  test("human precedents separates explicit and candidate sections; known-empty exits 0", async () => {
    const incidentId = await seedQueryIncident(dir);

    const result = await capture(() =>
      main(["precedents", "--incident", incidentId, "--dir", dir]),
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("EXPLICIT PRECEDENTS");
    expect(result.stdout).toContain("CANDIDATE PRECEDENTS");
    expect(result.stdout).toContain("candidates");
    expect(result.stdout.toLowerCase()).toContain("does not claim similarity");
    expect(result.stdout.toLowerCase()).toContain("recommend a response");
    expect(result.stdout).toContain("temporally prior");
    expect(result.stdout).toContain("effectiveAt");
  });

  test("precedents --json matches shared projection; unknown id fails", async () => {
    const incidentId = await seedQueryIncident(dir);

    const result = await capture(() =>
      main(["precedents", "--incident", incidentId, "--json", "--dir", dir]),
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const parsed = JSON.parse(result.stdout);
    const expected = safeJson(
      projectIncidentPrecedentSet(
        composeIncidentPrecedents(dir, incidentId),
      ),
    );
    expect(parsed).toEqual(expected);
    expect(parsed).toHaveProperty("queryIncident");
    expect(parsed).toHaveProperty("explicitPrecedents");
    expect(parsed).toHaveProperty("candidatePrecedents");
    expect(JSON.stringify(parsed)).not.toContain("[Circular]");

    const memory = toIncidentPrecedentMemory([
      composeIncidentPrecedents(dir, incidentId),
    ]);
    expect(memory).toHaveLength(1);
    expect(memory[0]).toEqual(parsed);

    const missing = await capture(() =>
      main([
        "precedents",
        "--incident",
        "inc:does-not-exist",
        "--json",
        "--dir",
        dir,
      ]),
    );
    expect(missing.code).toBe(1);
  });

  test("precedents requires exactly one --incident", async () => {
    const missing = await capture(() =>
      main(["precedents", "--dir", dir]),
    );
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("--incident");

    const incidentId = await seedQueryIncident(dir);
    const extra = await capture(() =>
      main([
        "precedents",
        "--incident",
        incidentId,
        "--incident",
        "inc:other",
        "--dir",
        dir,
      ]),
    );
    expect(extra.code).toBe(1);
  });

  test("CLI JSON omits future and equal-time peers as precedents", async () => {
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "vercel",
      providerResourceId: "prj_temporal_cli",
      kind: "project",
      name: "temporal-cli",
      metadata: {},
    });
    store.applyResource(project, {
      id: "obs-temporal-cli",
      observedAt: "2026-01-01T00:00:00.000Z",
    });
    store.close();

    async function res(decision: string): Promise<string> {
      const out = await capture(() =>
        main([
          "resolution",
          "--resource",
          project.id,
          "--decision",
          decision,
          "--dir",
          dir,
        ]),
      );
      return out.stdout.match(/Recorded resolution (res:\S+)/)![1]!;
    }

    const q1 = await res("q1");
    const q2 = await res("q2");
    const f1 = await res("f1");
    const f2 = await res("f2");
    const p1 = await res("p1");
    const p2 = await res("p2");

    const queryOut = await capture(() =>
      main([
        "incident",
        "--resolution",
        q1,
        "--resolution",
        q2,
        "--title",
        "Jan 1",
        "--dir",
        dir,
      ]),
    );
    const queryId = queryOut.stdout.match(/Recorded incident (inc:\S+)/)![1]!;
    // Rewrite recordedAt via store for deterministic times
    {
      const s = new Store(dir);
      s.init();
      s.updateIncidentRecordedAt(queryId, "2026-01-01T12:00:00.000Z");
      s.close();
    }

    const futureOut = await capture(() =>
      main([
        "incident",
        "--resolution",
        f1,
        "--resolution",
        f2,
        "--title",
        "Jan 2",
        "--dir",
        dir,
      ]),
    );
    const futureId = futureOut.stdout.match(/Recorded incident (inc:\S+)/)![1]!;
    {
      const s = new Store(dir);
      s.init();
      s.updateIncidentRecordedAt(futureId, "2026-01-02T12:00:00.000Z");
      s.close();
    }

    const priorOut = await capture(() =>
      main([
        "incident",
        "--resolution",
        p1,
        "--resolution",
        p2,
        "--title",
        "Dec 31",
        "--dir",
        dir,
      ]),
    );
    const priorId = priorOut.stdout.match(/Recorded incident (inc:\S+)/)![1]!;
    {
      const s = new Store(dir);
      s.init();
      s.updateIncidentRecordedAt(priorId, "2025-12-31T12:00:00.000Z");
      s.close();
    }

    await capture(() =>
      main([
        "incident-link",
        "--incident",
        queryId,
        "--incident",
        futureId,
        "--reason",
        "Future link is not a precedent",
        "--dir",
        dir,
      ]),
    );

    const json = await capture(() =>
      main(["precedents", "--incident", queryId, "--json", "--dir", dir]),
    );
    expect(json.code).toBe(0);
    const parsed = JSON.parse(json.stdout);
    expect(parsed.candidatePrecedents.map((c: { incident: { id: string } }) => c.incident.id)).toEqual([
      priorId,
    ]);
    expect(parsed.explicitPrecedents).toEqual([]);
    expect(
      parsed.candidatePrecedents.some(
        (c: { incident: { id: string } }) => c.incident.id === futureId,
      ),
    ).toBe(false);

    const links = await capture(() =>
      main(["incident-links", "--incident", queryId, "--dir", dir]),
    );
    expect(links.code).toBe(0);
    expect(links.stdout).toContain("ilink:");
  });

  test("precedents --json includes responseExperience with zero Circular; human shows RECORDED RESPONSE EXPERIENCE", async () => {
    const store = new Store(dir);
    store.init();
    const project = createResource({
      provider: "vercel",
      providerResourceId: "prj_exp_cli",
      kind: "project",
      name: "exp-cli-project",
      metadata: {},
    });
    store.applyResource(project, {
      id: "obs-exp-cli",
      observedAt: "2026-08-26T00:00:00.000Z",
    });
    store.close();

    const q1 = recordResolution({
      baseDir: dir,
      subjectResourceId: project.id,
      decision: "q1",
      recordedAt: "2026-08-26T10:00:00.000Z",
    });
    const q2 = recordResolution({
      baseDir: dir,
      subjectResourceId: project.id,
      decision: "q2",
      recordedAt: "2026-08-26T10:01:00.000Z",
    });
    const p1 = recordResolution({
      baseDir: dir,
      subjectResourceId: project.id,
      decision: "p1",
      recordedAt: "2026-08-24T10:00:00.000Z",
    });
    const p2 = recordResolution({
      baseDir: dir,
      subjectResourceId: project.id,
      decision: "p2",
      recordedAt: "2026-08-24T10:01:00.000Z",
    });

    const query = recordIncident({
      baseDir: dir,
      resolutionIds: [q1.id, q2.id],
      recordedAt: "2026-08-26T12:00:00.000Z",
      title: "Query",
    });
    const prior = recordIncident({
      baseDir: dir,
      resolutionIds: [p1.id, p2.id],
      recordedAt: "2026-08-24T12:00:00.000Z",
      title: "Prior",
    });
    recordIncidentLink({
      baseDir: dir,
      incidentIds: [prior.id, query.id],
      reason: "Same customer-visible failure mode",
      recordedAt: "2026-08-27T09:00:00.000Z",
    });

    const rec = recordRecommendation({
      baseDir: dir,
      incidentId: prior.id,
      subjectResourceId: project.id,
      actionKey: "rollback-deployment",
      proposal: "Roll back",
      recordedAt: "2026-08-24T13:00:00.000Z",
    });
    const dec = recordDecision({
      baseDir: dir,
      recommendationId: rec.id,
      disposition: "approved",
      recordedAt: "2026-08-24T13:05:00.000Z",
    });
    const act = recordAction({
      baseDir: dir,
      decisionId: dec.id,
      actionKey: "rollback-deployment",
      summary: "Rolled back",
      recordedAt: "2026-08-24T13:10:00.000Z",
    });
    recordOutcome({
      baseDir: dir,
      actionId: act.id,
      assessment: "positive",
      summary: "Recovered",
      recordedAt: "2026-08-24T13:20:00.000Z",
    });

    const json = await capture(() =>
      main(["precedents", "--incident", query.id, "--json", "--dir", dir]),
    );
    expect(json.code).toBe(0);
    expect(json.stderr).toBe("");
    const parsed = JSON.parse(json.stdout);
    expect(parsed).toHaveProperty("responseExperience");
    expect(parsed.responseExperience.queryIncidentId).toBe(query.id);
    expect(parsed.responseExperience.explicitPrecedentIds).toEqual([prior.id]);
    expect(JSON.stringify(parsed)).not.toContain("[Circular]");

    const human = await capture(() =>
      main(["precedents", "--incident", query.id, "--dir", dir]),
    );
    expect(human.code).toBe(0);
    expect(human.stdout).toContain("RECORDED RESPONSE EXPERIENCE");
  });
});
