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

async function seedTwoIncidents(dir: string): Promise<{
  subjectId: string;
  incidentA: string;
  incidentB: string;
}> {
  const store = new Store(dir);
  store.init();
  const project = createResource({
    provider: "vercel",
    providerResourceId: "prj_ilink_cli",
    kind: "project",
    name: "ilink-cli-project",
    metadata: {},
  });
  store.applyResource(project, {
    id: "obs-ilink-cli",
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
  const r3 = await capture(() =>
    main([
      "resolution",
      "--resource",
      project.id,
      "--decision",
      "Inspect",
      "--dir",
      dir,
    ]),
  );
  const r4 = await capture(() =>
    main([
      "resolution",
      "--resource",
      project.id,
      "--decision",
      "Retry",
      "--dir",
      dir,
    ]),
  );
  const res1 = r1.stdout.match(/Recorded resolution (res:\S+)/)![1]!;
  const res2 = r2.stdout.match(/Recorded resolution (res:\S+)/)![1]!;
  const res3 = r3.stdout.match(/Recorded resolution (res:\S+)/)![1]!;
  const res4 = r4.stdout.match(/Recorded resolution (res:\S+)/)![1]!;

  const incA = await capture(() =>
    main([
      "incident",
      "--resolution",
      res1,
      "--resolution",
      res2,
      "--title",
      "Spike A",
      "--dir",
      dir,
    ]),
  );
  const incB = await capture(() =>
    main([
      "incident",
      "--resolution",
      res3,
      "--resolution",
      res4,
      "--title",
      "Spike B",
      "--dir",
      dir,
    ]),
  );
  return {
    subjectId: project.id,
    incidentA: incA.stdout.match(/Recorded incident (inc:\S+)/)![1]!,
    incidentB: incB.stdout.match(/Recorded incident (inc:\S+)/)![1]!,
  };
}

describe("CLI incident-link / incident-links", () => {
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "combie-cli-ilink-"));
    await capture(() => main(["init", "--dir", dir]));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("help --all lists incident-link and incident-links", async () => {
    const help = await capture(() => main(["help", "--all"]));
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("incident-link");
    expect(help.stdout).toContain("incident-links");
    expect(help.stdout).toContain("--reason");
  });

  test("--json is rejected on incident-link and incident-links", async () => {
    for (const command of ["incident-link", "incident-links"]) {
      const result = await capture(() =>
        main([command, "--json", "--dir", dir]),
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("only available for");
      expect(result.stderr).toContain("precedents");
      expect(result.stderr).not.toMatch(/incident-link/);
    }
  });

  test("records, shows, and lists an explicit incident link", async () => {
    const { incidentA, incidentB } = await seedTwoIncidents(dir);

    const recorded = await capture(() =>
      main([
        "incident-link",
        "--incident",
        incidentA,
        "--incident",
        incidentB,
        "--reason",
        "Same failure mode",
        "--dir",
        dir,
      ]),
    );
    expect(recorded.code).toBe(0);
    expect(recorded.stdout).toContain("Recorded incident link ilink:");
    expect(recorded.stdout).toContain("Same failure mode");
    const linkId = recorded.stdout.match(
      /Recorded incident link (ilink:\S+)/,
    )![1]!;

    const shown = await capture(() =>
      main(["incident-link", linkId, "--dir", dir]),
    );
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain(linkId);
    expect(shown.stdout).toContain(incidentA);
    expect(shown.stdout).toContain(incidentB);
    expect(shown.stdout).toContain("Same failure mode");

    const listed = await capture(() =>
      main(["incident-links", "--dir", dir]),
    );
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain(linkId);

    const filtered = await capture(() =>
      main(["incident-links", "--incident", incidentA, "--dir", dir]),
    );
    expect(filtered.code).toBe(0);
    expect(filtered.stdout).toContain(linkId);

    const empty = await capture(() =>
      main([
        "incident-links",
        "--incident",
        "inc:does-not-exist-filter",
        "--dir",
        dir,
      ]),
    );
    expect(empty.code).toBe(0);
    expect(empty.stdout).toContain("known-empty");
  });

  test("duplicate or reverse pair create fails; incidents stay unchanged", async () => {
    const { incidentA, incidentB } = await seedTwoIncidents(dir);

    const first = await capture(() =>
      main([
        "incident-link",
        "--incident",
        incidentA,
        "--incident",
        incidentB,
        "--reason",
        "Same failure mode",
        "--dir",
        dir,
      ]),
    );
    expect(first.code).toBe(0);

    const reverse = await capture(() =>
      main([
        "incident-link",
        "--incident",
        incidentB,
        "--incident",
        incidentA,
        "--reason",
        "Different reason",
        "--dir",
        dir,
      ]),
    );
    expect(reverse.code).toBe(1);
    expect(reverse.stderr).toMatch(/INCIDENT_LINK_EXISTS|already|exists/i);

    const shownA = await capture(() =>
      main(["incident", incidentA, "--dir", dir]),
    );
    expect(shownA.code).toBe(0);
    expect(shownA.stdout).toContain("Spike A");
    expect(shownA.stdout).not.toContain("ilink:");
  });

  test("create requires exactly two distinct incidents and a reason", async () => {
    const { incidentA } = await seedTwoIncidents(dir);

    const one = await capture(() =>
      main([
        "incident-link",
        "--incident",
        incidentA,
        "--reason",
        "Incomplete",
        "--dir",
        dir,
      ]),
    );
    expect(one.code).toBe(1);

    const dup = await capture(() =>
      main([
        "incident-link",
        "--incident",
        incidentA,
        "--incident",
        incidentA,
        "--reason",
        "Same id twice",
        "--dir",
        dir,
      ]),
    );
    expect(dup.code).toBe(1);

    const noReason = await capture(() =>
      main([
        "incident-link",
        "--incident",
        incidentA,
        "--incident",
        "inc:other",
        "--dir",
        dir,
      ]),
    );
    expect(noReason.code).toBe(1);
  });
});
