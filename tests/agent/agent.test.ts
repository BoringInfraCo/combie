import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  findExecutable,
} from "../../src/agent/detection.ts";
import {
  buildMcpInvocation,
  entryMatchesInvocation,
} from "../../src/agent/invocation.ts";
import {
  readClaudeEntry,
  removeClaude,
  setupClaude,
} from "../../src/agent/claude.ts";
import {
  readCodexEntry,
  removeCodex,
  setupCodex,
} from "../../src/agent/codex.ts";
import {
  readCursorEntry,
  removeCursor,
  setupCursor,
} from "../../src/agent/cursor.ts";
import {
  SKILL_INSTALL_COMMAND,
  formatAgentStatusTable,
  formatSkillInstallHint,
  inspectAgents,
  removeAgents,
  setupAgents,
} from "../../src/app/agent.ts";
import { main } from "../../src/cli/index.ts";
import { BINARY_NAME } from "../../src/cli/constants.ts";
import { initCombie } from "../../src/app/init.ts";
import { resolveAgentCombieHome } from "../../src/storage/paths.ts";
import { resolve } from "node:path";

const PROJECT_ROOT = dirname(dirname(import.meta.dir));

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

describe("detection", () => {
  test("finds an executable on PATH", () => {
    const bin = mkdtempSync(join(tmpdir(), "combie-bin-"));
    const fake = join(bin, "codex");
    writeFileSync(fake, "#!/bin/sh\n");
    chmodSync(fake, 0o755);
    try {
      const result = findExecutable("codex", {
        ...process.env,
        PATH: bin,
      });
      expect(result.detected).toBe(true);
      expect(result.executablePath).toBe(fake);
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });

  test("returns not detected when not on PATH", () => {
    const result = findExecutable("cursor", { PATH: "/nonexistent" });
    expect(result.detected).toBe(false);
    expect(result.executablePath).toBeNull();
  });
});

describe("invocation", () => {
  test("builds the checkout form from the Combie checkout", () => {
    const invocation = buildMcpInvocation("/tmp/state/.combie");
    expect(invocation.command).toBe("bun");
    expect(invocation.args).toEqual([
      "run",
      "--cwd",
      PROJECT_ROOT,
      "combie",
      "mcp",
    ]);
    expect(invocation.env.COMBIE_HOME).toBe("/tmp/state/.combie");
  });

  test("entryMatchesInvocation accepts exact entries", () => {
    const invocation = buildMcpInvocation("/state/.combie");
    const entry = {
      command: "bun",
      args: ["run", "--cwd", PROJECT_ROOT, "combie", "mcp"],
      env: { COMBIE_HOME: "/state/.combie", EXTRA: "kept" },
    };
    expect(entryMatchesInvocation(entry, invocation)).toBe(true);
  });

  test("entryMatchesInvocation accepts the documented Codex cwd form", () => {
    const invocation = buildMcpInvocation("/state/.combie");
    const entry = {
      command: "bun",
      args: ["run", "combie", "mcp"],
      cwd: PROJECT_ROOT,
      env: { COMBIE_HOME: "/state/.combie" },
    };
    expect(entryMatchesInvocation(entry, invocation)).toBe(true);
    const entry2 = {
      command: "bun",
      args: ["combie", "mcp"],
      cwd: PROJECT_ROOT,
      env: { COMBIE_HOME: "/state/.combie" },
    };
    expect(entryMatchesInvocation(entry2, invocation)).toBe(true);
  });

  test("entryMatchesInvocation rejects a different COMBIE_HOME", () => {
    const invocation = buildMcpInvocation("/state/.combie");
    const entry = {
      command: "bun",
      args: ["run", "--cwd", PROJECT_ROOT, "combie", "mcp"],
      env: { COMBIE_HOME: "/other/.combie" },
    };
    expect(entryMatchesInvocation(entry, invocation)).toBe(false);
  });

  test("entryMatchesInvocation rejects a different project", () => {
    const invocation = buildMcpInvocation("/state/.combie");
    const entry = {
      command: "bun",
      args: ["run", "--cwd", "/elsewhere", "combie", "mcp"],
      env: { COMBIE_HOME: "/state/.combie" },
    };
    expect(entryMatchesInvocation(entry, invocation)).toBe(false);
  });
});

describe("agent integrations", () => {
  let home: string;
  let baseDir: string;
  let binDir: string;
  const origHome = process.env.HOME;
  const origPath = process.env.PATH;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "combie-home-"));
    baseDir = mkdtempSync(join(tmpdir(), "combie-state-"));
    binDir = mkdtempSync(join(tmpdir(), "combie-bin-"));
    for (const name of ["claude", "cursor"]) {
      const fake = join(binDir, name);
      writeFileSync(fake, "#!/bin/sh\n");
      chmodSync(fake, 0o755);
    }
    process.env.HOME = home;
    process.env.PATH = binDir;
  });

  afterEach(() => {
    if (origHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = origHome;
    }
    if (origPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = origPath;
    }
    rmSync(home, { recursive: true, force: true });
    rmSync(baseDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  });

  test("claude setup writes the MCP entry and is idempotent", () => {
    expect(setupClaude(baseDir)).toBe(true);
    const entry = readClaudeEntry();
    expect(entry).not.toBeNull();
    expect(entry!.command).toBe("bun");
    expect(entry!.args[1]).toBe("--cwd");
    expect(entry!.env.COMBIE_HOME).toBe(baseDir);
    const text = readFileSync(join(home, ".claude.json"), "utf8");
    expect(text).toContain('"type": "stdio"');
    expect(setupClaude(baseDir)).toBe(false);
  });

  test("claude setup preserves unrelated servers and top-level keys", () => {
    writeFileSync(
      join(home, ".claude.json"),
      `{
  "globalAccountId": "abc",
  "mcpServers": {
    "other-server": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "other"]
    }
  }
}
`,
    );
    setupClaude(baseDir);
    const parsed = JSON.parse(
      readFileSync(join(home, ".claude.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(parsed.globalAccountId).toBe("abc");
    expect(
      (parsed.mcpServers as Record<string, unknown>)["other-server"],
    ).toEqual({
      type: "stdio",
      command: "bun",
      args: ["run", "other"],
    });
  });

  test("claude setup updates a stale entry in place", () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          combie: {
            type: "stdio",
            command: "bun",
            args: ["run", "--cwd", "/old/project", "combie", "mcp"],
            env: { COMBIE_HOME: "/old/.combie" },
          },
        },
      }),
    );
    setupClaude(baseDir);
    const entry = readClaudeEntry();
    expect(entry!.env.COMBIE_HOME).toBe(baseDir);
    expect(entry!.args[2]).toBe(PROJECT_ROOT);
  });

  test("claude remove is surgical and idempotent", () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          combie: { command: "bun", args: [] },
          other: { command: "node", args: [] },
        },
      }),
    );
    expect(removeClaude()).toBe(true);
    const parsed = JSON.parse(
      readFileSync(join(home, ".claude.json"), "utf8"),
    ) as Record<string, Record<string, unknown>>;
    expect(parsed.mcpServers!["combie"]).toBeUndefined();
    expect(parsed.mcpServers!["other"]).toEqual({ command: "node", args: [] });
    expect(removeClaude()).toBe(false);
  });

  test("claude remove drops an emptied mcpServers object", () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { combie: { command: "bun", args: [] } } }),
    );
    removeClaude();
    const parsed = JSON.parse(
      readFileSync(join(home, ".claude.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(parsed.mcpServers).toBeUndefined();
  });

  test("claude invalid config fails safely", () => {
    writeFileSync(join(home, ".claude.json"), "{ invalid");
    expect(() => setupClaude(baseDir)).toThrow(/Refusing to modify/);
    expect(readFileSync(join(home, ".claude.json"), "utf8")).toBe("{ invalid");
  });

  test("codex setup writes the TOML sections and is idempotent", () => {
    expect(setupCodex(baseDir)).toBe(true);
    const entry = readCodexEntry();
    expect(entry).not.toBeNull();
    expect(entry!.command).toBe("bun");
    expect(entry!.args[1]).toBe("--cwd");
    expect(entry!.env.COMBIE_HOME).toBe(baseDir);
    expect(setupCodex(baseDir)).toBe(false);
  });

  test("codex setup accepts the documented cwd-form entry as configured", () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(
      join(home, ".codex", "config.toml"),
      `[mcp_servers.combie]
command = "bun"
args = ["run", "combie", "mcp"]
cwd = "${PROJECT_ROOT}"

[mcp_servers.combie.env]
COMBIE_HOME = "${baseDir}"
`,
    );
    expect(setupCodex(baseDir)).toBe(false);
    expect(readCodexEntry()!.env.COMBIE_HOME).toBe(baseDir);
  });

  test("codex setup migrates an env sub-section to an inline table", () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(
      join(home, ".codex", "config.toml"),
      `model = "gpt-5"

[mcp_servers.combie]
command = "bun"
args = ["run", "--cwd", "/old", "combie", "mcp"]

[mcp_servers.combie.env]
COMBIE_HOME = "/old/.combie"
`,
    );
    expect(setupCodex(baseDir)).toBe(true);
    const text = readFileSync(join(home, ".codex", "config.toml"), "utf8");
    expect(text).toContain('model = "gpt-5"');
    expect(text).not.toContain("mcp_servers.combie.env");
    expect(text).toContain("COMBIE_HOME");
    expect(readCodexEntry()!.env.COMBIE_HOME).toBe(baseDir);
  });

  test("codex remove removes only the combie sections", () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(
      join(home, ".codex", "config.toml"),
      `[model]
model = "gpt-5"

[mcp_servers.combie]
command = "bun"

[mcp_servers.other]
command = "node"
`,
    );
    expect(removeCodex()).toBe(true);
    const text = readFileSync(join(home, ".codex", "config.toml"), "utf8");
    expect(text).toContain("[model]");
    expect(text).toContain("[mcp_servers.other]");
    expect(text).not.toContain("mcp_servers.combie]");
    expect(removeCodex()).toBe(false);
  });

  test("cursor setup writes mcp.json and is idempotent", () => {
    expect(setupCursor(baseDir)).toBe(true);
    const entry = readCursorEntry();
    expect(entry).not.toBeNull();
    expect(entry!.command).toBe("bun");
    expect(entry!.env.COMBIE_HOME).toBe(baseDir);
    expect(setupCursor(baseDir)).toBe(false);
  });

  test("cursor setup preserves unrelated servers", () => {
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(
      join(home, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "node", args: [] } } }),
    );
    setupCursor(baseDir);
    const parsed = JSON.parse(
      readFileSync(join(home, ".cursor", "mcp.json"), "utf8"),
    ) as Record<string, Record<string, unknown>>;
    expect(parsed.mcpServers!["other"]).toEqual({ command: "node", args: [] });
  });

  test("cursor remove is idempotent", () => {
    expect(removeCursor()).toBe(false);
    setupCursor(baseDir);
    expect(removeCursor()).toBe(true);
    expect(readCursorEntry()).toBeNull();
  });

  test("status shows configured/stale/available/not_detected", () => {
    setupClaude(baseDir);
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(
      join(home, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          combie: {
            command: "bun",
            args: ["run", "--cwd", "/old", "combie", "mcp"],
            env: { COMBIE_HOME: "/old" },
          },
        },
      }),
    );
    const statuses = inspectAgents(baseDir);
    const byKind = Object.fromEntries(statuses.map((s) => [s.kind, s]));
    expect(byKind["claude"]!.status).toBe("configured");
    expect(byKind["cursor"]!.status).toBe("stale");
    expect(byKind["codex"]!.status).toBe("not_detected");
  });

  test("invalid config shows invalid status without throwing", () => {
    writeFileSync(join(home, ".claude.json"), "{ broken");
    const statuses = inspectAgents(baseDir);
    const claude = statuses.find((s) => s.kind === "claude");
    expect(claude!.status).toBe("invalid");
  });

  test("formatAgentStatusTable uses uppercase headers", () => {
    const table = formatAgentStatusTable(inspectAgents(baseDir));
    expect(table).toContain("AGENT");
    expect(table).toContain("DETECTED");
    expect(table).toContain("INTEGRATION");
  });

  test("setupAgents rejects unknown agents", () => {
    expect(() => setupAgents(["gemini"], baseDir)).toThrow(/Unknown agent/);
    expect(() => setupAgents(["GEMINI"], baseDir)).toThrow(/Unknown agent/);
  });

  test("setupAgents scopes to requested agents", () => {
    const results = setupAgents(["claude"], baseDir);
    expect(results.map((r) => r.kind)).toEqual(["claude"]);
    expect(existsSync(join(home, ".claude.json"))).toBe(true);
    expect(existsSync(join(home, ".cursor"))).toBe(false);
  });

  test("removeAgents returns no-change messages when absent", () => {
    const results = removeAgents(["claude"]);
    expect(results[0]!.changed).toBe(false);
    expect(results[0]!.message).toContain("no Combie MCP entry present");
  });
});

describe("CLI agent commands", () => {
  let home: string;
  let binDir: string;
  const origHome = process.env.HOME;
  const origPath = process.env.PATH;
  const origCombieHome = process.env.COMBIE_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "combie-cli-agent-"));
    binDir = mkdtempSync(join(tmpdir(), "combie-cli-agent-bin-"));
    for (const name of ["claude", "codex", "cursor"]) {
      const fake = join(binDir, name);
      writeFileSync(fake, "#!/bin/sh\n");
      chmodSync(fake, 0o755);
    }
    process.env.HOME = home;
    process.env.PATH = binDir;
    delete process.env.COMBIE_HOME;
  });

  afterEach(() => {
    if (origHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = origHome;
    }
    if (origPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = origPath;
    }
    if (origCombieHome === undefined) {
      delete process.env.COMBIE_HOME;
    } else {
      process.env.COMBIE_HOME = origCombieHome;
    }
    rmSync(home, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  });

  test("agent status prints the table", async () => {
    const result = await capture(() => main(["agent", "status"]));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("AGENT");
    expect(result.stdout).toContain("Claude Code");
    expect(result.stdout).toContain("Codex");
    expect(result.stdout).toContain("Cursor");
  });

  test("agent setup without args configures all agents without prompting (non-TTY)", async () => {
    const result = await capture(() =>
      main(["agent", "setup", "--yes", "--dir", home + "/.combie"]),
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Claude Code configured");
    expect(result.stdout).toContain("Codex configured");
    expect(result.stdout).toContain("Cursor configured");
    expect(JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8"))).toBeDefined();
  });

  test("agent setup is a no-op when everything is configured", async () => {
    await capture(() =>
      main(["agent", "setup", "--yes", "--dir", home + "/.combie"]),
    );
    const result = await capture(() =>
      main(["agent", "setup", "--yes", "--dir", home + "/.combie"]),
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("All requested agents are already configured.");
  });

  test("agent setup prints the optional skill install hint", async () => {
    const result = await capture(() =>
      main(["agent", "setup", "--yes", "--dir", home + "/.combie"]),
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Skill (optional):");
    expect(result.stdout).toContain(SKILL_INSTALL_COMMAND);
  });

  test("agent setup no-op keeps printing the skill install hint", async () => {
    await capture(() =>
      main(["agent", "setup", "--yes", "--dir", home + "/.combie"]),
    );
    const result = await capture(() =>
      main(["agent", "setup", "--yes", "--dir", home + "/.combie"]),
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("All requested agents are already configured.");
    expect(result.stdout).toContain(SKILL_INSTALL_COMMAND);
  });

  test("agent status omits the skill install hint", async () => {
    const result = await capture(() => main(["agent", "status"]));
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain("Skill (optional):");
  });

  test("agent remove omits the skill install hint", async () => {
    await capture(() =>
      main(["agent", "setup", "--yes", "--dir", home + "/.combie"]),
    );
    const result = await capture(() =>
      main(["agent", "remove", "claude", "--yes"]),
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("removed");
    expect(result.stdout).not.toContain("Skill (optional):");
  });

  test("agent setup rejects unknown agents", async () => {
    const result = await capture(() =>
      main(["agent", "setup", "gemini", "--dir", home + "/.combie"]),
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Unknown agent");
  });

  test("agent remove without args is a usage error", async () => {
    const result = await capture(() => main(["agent", "remove"]));
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("agent remove <agent...>");
  });

  test("agent remove clears the combie entry", async () => {
    await capture(() =>
      main(["agent", "setup", "--yes", "--dir", home + "/.combie"]),
    );
    const result = await capture(() =>
      main(["agent", "remove", "claude", "--yes"]),
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("removed");
    const text = readFileSync(join(home, ".claude.json"), "utf8");
    expect(text).not.toContain('"combie"');
  });

  test("agent subcommand usage errors", async () => {
    const result = await capture(() => main(["agent"]));
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("agent <setup|status|remove>");

    const bad = await capture(() => main(["agent", "frobnicate"]));
    expect(bad.code).not.toBe(0);
    expect(bad.stderr).toContain("Unknown agent command");
  });

  test("help --all lists the agent commands", async () => {
    const result = await capture(() => main(["help", "--all"]));
    expect(result.stdout).toContain("agent status");
    expect(result.stdout).toContain("agent setup");
    expect(result.stdout).toContain("agent remove");
  });

  test("agent setup without --dir embeds $HOME/.combie when cwd has no store", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "combie-cli-agent-cwd-"));
    const origCwd = process.cwd();
    process.chdir(cwd);
    try {
      const result = await capture(() => main(["agent", "setup", "--yes"]));
      expect(result.code).toBe(0);
      expect(result.stdout).toContain(`Combie home: ${join(home, ".combie")}`);
      expect(readCursorEntry()?.env.COMBIE_HOME).toBe(join(home, ".combie"));
    } finally {
      process.chdir(origCwd);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("agent setup without --dir embeds initialized cwd store", async () => {
    const project = mkdtempSync(join(tmpdir(), "combie-cli-agent-project-"));
    const origCwd = process.cwd();
    process.chdir(project);
    try {
      initCombie(join(project, ".combie"));
      const result = await capture(() => main(["agent", "setup", "--yes"]));
      expect(result.code).toBe(0);
      expect(result.stdout).not.toContain("Combie home:");
      expect(readCursorEntry()?.env.COMBIE_HOME).toBe(
        resolve(process.cwd(), ".combie"),
      );
    } finally {
      process.chdir(origCwd);
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("agent setup prefers COMBIE_HOME over initialized cwd store", async () => {
    const project = mkdtempSync(join(tmpdir(), "combie-cli-agent-project-"));
    const envStore = join(home, "env-store");
    const origCwd = process.cwd();
    const origCombieHome = process.env.COMBIE_HOME;
    process.chdir(project);
    process.env.COMBIE_HOME = envStore;
    try {
      initCombie(envStore);
      initCombie(join(project, ".combie"));
      const result = await capture(() => main(["agent", "setup", "--yes"]));
      expect(result.code).toBe(0);
      expect(readCursorEntry()?.env.COMBIE_HOME).toBe(resolve(envStore));
    } finally {
      process.chdir(origCwd);
      if (origCombieHome === undefined) {
        delete process.env.COMBIE_HOME;
      } else {
        process.env.COMBIE_HOME = origCombieHome;
      }
      rmSync(project, { recursive: true, force: true });
      rmSync(envStore, { recursive: true, force: true });
    }
  });

  test("agent setup prefers --dir over COMBIE_HOME and cwd store", async () => {
    const project = mkdtempSync(join(tmpdir(), "combie-cli-agent-project-"));
    const explicit = join(home, "explicit-store");
    const envStore = join(home, "env-store");
    const origCwd = process.cwd();
    const origCombieHome = process.env.COMBIE_HOME;
    process.chdir(project);
    process.env.COMBIE_HOME = envStore;
    try {
      initCombie(explicit);
      initCombie(envStore);
      initCombie(join(project, ".combie"));
      const result = await capture(() =>
        main(["agent", "setup", "--yes", "--dir", explicit]),
      );
      expect(result.code).toBe(0);
      expect(readCursorEntry()?.env.COMBIE_HOME).toBe(resolve(explicit));
    } finally {
      process.chdir(origCwd);
      if (origCombieHome === undefined) {
        delete process.env.COMBIE_HOME;
      } else {
        process.env.COMBIE_HOME = origCombieHome;
      }
      rmSync(project, { recursive: true, force: true });
      rmSync(explicit, { recursive: true, force: true });
      rmSync(envStore, { recursive: true, force: true });
    }
  });

  test("agent setup rewrites a stale pre-103 CWD-dependent entry", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "combie-cli-agent-cwd-"));
    const staleHome = join(cwd, ".combie");
    const origCwd = process.cwd();
    process.chdir(cwd);
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          combie: {
            type: "stdio",
            command: process.execPath,
            args: ["mcp"],
            env: { COMBIE_HOME: staleHome },
          },
        },
      }),
    );
    try {
      const result = await capture(() => main(["agent", "setup", "--yes"]));
      expect(result.code).toBe(0);
      expect(readClaudeEntry()?.env.COMBIE_HOME).toBe(join(home, ".combie"));
      expect(result.stdout).toContain("Claude Code configured");
    } finally {
      process.chdir(origCwd);
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("resolveAgentCombieHome", () => {
  let home: string;
  const origHome = process.env.HOME;
  const origCombieHome = process.env.COMBIE_HOME;
  const origCwd = process.cwd();

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "combie-agent-home-"));
    process.env.HOME = home;
    delete process.env.COMBIE_HOME;
  });

  afterEach(() => {
    process.chdir(origCwd);
    if (origHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = origHome;
    }
    if (origCombieHome === undefined) {
      delete process.env.COMBIE_HOME;
    } else {
      process.env.COMBIE_HOME = origCombieHome;
    }
    rmSync(home, { recursive: true, force: true });
  });

  test("uses explicit --dir", () => {
    const resolution = resolveAgentCombieHome({ dir: "/tmp/explicit" });
    expect(resolution.baseDir).toBe(resolve("/tmp/explicit"));
    expect(resolution.usedHomeFallback).toBe(false);
  });

  test("uses COMBIE_HOME when set", () => {
    process.env.COMBIE_HOME = "/tmp/env-home";
    const resolution = resolveAgentCombieHome({});
    expect(resolution.baseDir).toBe(resolve("/tmp/env-home"));
    expect(resolution.usedHomeFallback).toBe(false);
  });

  test("uses initialized cwd store when combie.db exists", () => {
    const project = mkdtempSync(join(tmpdir(), "combie-agent-project-"));
    process.chdir(project);
    initCombie(join(project, ".combie"));
    const resolution = resolveAgentCombieHome({});
    expect(resolution.baseDir).toBe(resolve(process.cwd(), ".combie"));
    expect(resolution.usedHomeFallback).toBe(false);
    rmSync(project, { recursive: true, force: true });
  });

  test("falls back to $HOME/.combie when no store exists", () => {
    const cwd = mkdtempSync(join(tmpdir(), "combie-agent-cwd-"));
    process.chdir(cwd);
    const resolution = resolveAgentCombieHome({});
    expect(resolution.baseDir).toBe(join(home, ".combie"));
    expect(resolution.usedHomeFallback).toBe(true);
    rmSync(cwd, { recursive: true, force: true });
  });

  test("falls through a cwd .combie directory that has no combie.db", () => {
    const cwd = mkdtempSync(join(tmpdir(), "combie-agent-junk-"));
    process.chdir(cwd);
    mkdirSync(join(cwd, ".combie"));
    const resolution = resolveAgentCombieHome({});
    expect(resolution.baseDir).toBe(join(home, ".combie"));
    expect(resolution.usedHomeFallback).toBe(true);
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("skill install hint", () => {
  test("exports the pinned command and two-line hint format", () => {
    expect(SKILL_INSTALL_COMMAND).toBe(
      "npx skills add BoringInfraCo/combie --skill combie -a cursor -a claude-code -a codex",
    );
    expect(formatSkillInstallHint()).toBe(
      "Skill (optional):\n  npx skills add BoringInfraCo/combie --skill combie -a cursor -a claude-code -a codex",
    );
  });
});
