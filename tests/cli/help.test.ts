import { describe, expect, test } from "bun:test";
import { main } from "../../src/cli/index.ts";

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

describe("CLI grouped help", () => {
  test("default and short help flags print grouped index", async () => {
    for (const argv of [[], ["help"], ["--help"], ["-h"]]) {
      const result = await capture(() => main(argv));
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Setup");
      expect(result.stdout).toContain("See");
      expect(result.stdout).toContain("Remember");
      expect(result.stdout).toContain("Agents");
      expect(result.stdout).toContain("investigate");
      expect(result.stdout).toContain("help <command>");
      expect(result.stdout).toContain("help --all");
      expect(result.stdout).not.toContain("--occurred-at");
      expect(result.stdout).not.toContain(
        "resolution --incident inc:… --resource github:repository:1001",
      );
      expect(result.stdout).not.toContain(
        "LAST SYNC is last successful sync",
      );
      expect(result.stdout).toContain("investigation [id]");
      expect(result.stdout).toContain("List or reopen");
      expect(result.stdout).toContain("resolution [id]");
      expect(result.stdout).toContain("incident [id]");
      expect(result.stdout).toContain("investigations");
      expect(result.stdout).toContain("resolutions");
      expect(result.stdout).toContain("incidents");
    }
  });

  test("help --all prints full catalog", async () => {
    const result = await capture(() => main(["help", "--all"]));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("--use-gh");
    expect(result.stdout).toContain("--json");
    expect(result.stdout).toContain("LAST SYNC is last successful sync");
    expect(result.stdout).not.toContain("--limit");
    expect(result.stdout).not.toContain("--offline");
    expect(result.stdout).not.toContain("--refresh");
    expect(result.stdout).toContain("incident inc:… --occurred-at");
  });

  test("investigate command help pages omit incident-only flags", async () => {
    for (const argv of [
      ["investigate", "--help"],
      ["help", "investigate"],
    ]) {
      const result = await capture(() => main(argv));
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("--save");
      expect(result.stdout).toContain("--task");
      expect(result.stdout).toContain("--json");
      expect(result.stdout).not.toContain("--occurred-at");
    }
  });

  test("help resolution lists resolution write flags", async () => {
    const result = await capture(() => main(["help", "resolution"]));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("--decision");
    expect(result.stdout).toContain("--resource");
    expect(result.stdout).toContain("--incident");
    expect(result.stdout).toContain(
      "at least one of --decision, --action, or --outcome",
    );
    expect(result.stdout).not.toContain("[--decision/--action/--outcome]");
  });

  test("version --help prints the version command page", async () => {
    const help = await capture(() => main(["version", "--help"]));
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("combie version");
    expect(help.stdout).toContain("--version");
    expect(help.stdout).not.toMatch(/^combie 0\.6\.2$/);

    const flag = await capture(() => main(["--version"]));
    expect(flag.code).toBe(0);
    expect(flag.stdout).toBe("combie 0.6.2");
  });

  test("help nosuch fails without dumping full catalog", async () => {
    const result = await capture(() => main(["help", "nosuch"]));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown help topic");
    expect(result.stderr).toContain("See:");
    expect(result.stderr).not.toContain("LAST SYNC is last successful sync");
  });

  test("unknown command fails without dumping full catalog", async () => {
    const result = await capture(() => main(["frobnicate"]));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown command: frobnicate");
    expect(result.stderr).toContain("See:");
    expect(result.stderr).not.toContain("LAST SYNC is last successful sync");
  });

  test("help --all cannot combine with command topic", async () => {
    for (const argv of [
      ["help", "--all", "investigate"],
      ["help", "investigate", "--all"],
    ]) {
      const result = await capture(() => main(argv));
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("help --all");
      expect(result.stderr).toContain("help <command>");
      expect(result.stderr).toContain("not both");
    }
  });

  test("help connect lists provider auth guidance", async () => {
    const result = await capture(() => main(["help", "connect"]));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("--use-gh");
    expect(
      result.stdout.includes("VERCEL_TOKEN") ||
        /connect.*env|use-env/i.test(result.stdout),
    ).toBe(true);
  });

  test("help incident lists incident mutation flags", async () => {
    const result = await capture(() => main(["help", "incident"]));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("--occurred-at");
    expect(result.stdout).toContain("--remove-resolution");
  });

  test("help agent lists agent subcommands", async () => {
    const result = await capture(() => main(["help", "agent"]));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("agent status");
    expect(result.stdout).toContain("agent setup");
    expect(result.stdout).toContain("agent remove");
  });
});
