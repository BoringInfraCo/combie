import { findExecutable } from "../agent/detection.ts";
import {
  buildMcpInvocation,
  entryMatchesInvocation,
} from "../agent/invocation.ts";
import {
  agentBackend,
  agentBackends,
  type AgentBackend,
} from "../agent/registry.ts";
import {
  AGENT_KINDS,
  type AgentRemoveResult,
  type AgentSetupResult,
  type AgentStatus,
  type AgentStatusInfo,
  type McpEntry,
} from "../agent/types.ts";
import { CombieError } from "./errors.ts";

export function unknownAgentError(name: string): CombieError {
  return new CombieError(
    "UNKNOWN_AGENT",
    `Unknown agent: ${name}.\nSupported agents: ${AGENT_KINDS.join(", ")}`,
  );
}

export function resolveAgentBackends(names: string[] | null): AgentBackend[] {
  if (names === null || names.length === 0) {
    return agentBackends();
  }
  return names.map((name) => {
    const kind = AGENT_KINDS.find((k) => k === name);
    if (!kind) {
      throw unknownAgentError(name);
    }
    return agentBackend(kind);
  });
}

/** True when any agent config already contains a matching Combie MCP entry. */
export function isAnyAgentMcpConfigured(baseDir: string): boolean {
  const invocation = buildMcpInvocation(baseDir);
  return agentBackends().some((backend) => {
    try {
      const entry = backend.readEntry();
      return entry !== null && entryMatchesInvocation(entry, invocation);
    } catch {
      return false;
    }
  });
}

export function inspectAgents(baseDir: string): AgentStatusInfo[] {
  const invocation = buildMcpInvocation(baseDir);
  return agentBackends().map((backend) => {
    const detection = findExecutable(backend.kind);
    let status: AgentStatus;
    let detail: string;
    if (!detection.detected) {
      status = "not_detected";
      detail = `${backend.label} executable not found in PATH`;
    } else {
      let entry: McpEntry | null;
      let invalid = false;
      try {
        entry = backend.readEntry();
      } catch {
        invalid = true;
        entry = null;
      }
      if (invalid) {
        status = "invalid";
        detail = `unusable config at ${backend.configPath()}`;
      } else if (entry === null) {
        status = "available";
        detail = `not configured (${backend.configPath()})`;
      } else if (entryMatchesInvocation(entry, invocation)) {
        status = "configured";
        detail = `configured (${backend.configPath()})`;
      } else {
        status = "stale";
        detail = `stale config at ${backend.configPath()}`;
      }
    }
    return {
      kind: backend.kind,
      label: backend.label,
      detected: detection.detected,
      status,
      configPath: backend.configPath(),
      detail,
    };
  });
}

export function setupAgents(
  names: string[] | null,
  baseDir: string,
): AgentSetupResult[] {
  const backends = resolveAgentBackends(names);
  const invocation = buildMcpInvocation(baseDir);
  return backends.map((backend) => {
    const configPath = backend.configPath();
    const current = backend.readEntry();
    if (current && entryMatchesInvocation(current, invocation)) {
      return {
        kind: backend.kind,
        label: backend.label,
        configPath,
        changed: false,
        message: `${backend.label} is already configured (${configPath})`,
      };
    }
    backend.writeEntry(baseDir);
    return {
      kind: backend.kind,
      label: backend.label,
      configPath,
      changed: true,
      message: `${backend.label} configured for MCP access (${configPath})`,
    };
  });
}

export function removeAgents(names: string[]): AgentRemoveResult[] {
  const backends = resolveAgentBackends(names);
  return backends.map((backend) => {
    const configPath = backend.configPath();
    const changed = backend.removeEntry();
    return {
      kind: backend.kind,
      label: backend.label,
      configPath,
      changed,
      message: changed
        ? `${backend.label}: Combie MCP entry removed (${configPath})`
        : `${backend.label}: no Combie MCP entry present (${configPath})`,
    };
  });
}

export function formatAgentStatusTable(statuses: AgentStatusInfo[]): string {
  if (statuses.length === 0) {
    return "No agents known.";
  }
  const rows = statuses.map((s) => ({
    agent: s.label,
    detected: s.detected ? "yes" : "no",
    integration: s.detail,
  }));
  const col1 = Math.max("AGENT".length, ...rows.map((r) => r.agent.length));
  const col2 = Math.max("DETECTED".length, ...rows.map((r) => r.detected.length));
  const header =
    "AGENT".padEnd(col1) + "  " + "DETECTED".padEnd(col2) + "  INTEGRATION";
  const body = rows
    .map(
      (r) =>
        r.agent.padEnd(col1) +
        "  " +
        r.detected.padEnd(col2) +
        "  " +
        r.integration,
    )
    .join("\n");
  return `${header}\n${body}`;
}

export const SKILL_INSTALL_COMMAND =
  "npx skills add BoringInfraCo/combie --skill combie -a cursor -a claude-code -a codex";

export function formatSkillInstallHint(): string {
  return `Skill (optional):\n  ${SKILL_INSTALL_COMMAND}`;
}
