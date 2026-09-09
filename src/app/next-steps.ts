import { isAnyAgentMcpConfigured } from "./agent.ts";
import { BINARY_NAME } from "../cli/constants.ts";
import { Store } from "../storage/store.ts";
import { listInvestigations } from "./investigations.ts";

export interface SyncNextStepsInput {
  results: Array<{ providerId: string; ok: boolean }>;
  ok: boolean;
  totalResources: number;
}

export interface NextStep {
  label: string;
  command: string;
  optional?: boolean;
}

export function formatNextStepsBlock(steps: NextStep[]): string {
  if (steps.length === 0) {
    return "";
  }
  const lines = ["Next steps:"];
  for (const step of steps) {
    const prefix = step.optional ? "(Optional) " : "";
    lines.push(`  ${prefix}${step.label}:`);
    lines.push(`    ${step.command}`);
  }
  return `\n${lines.join("\n")}`;
}

function withStore<T>(baseDir: string, fn: (store: Store) => T): T {
  const store = new Store(baseDir);
  try {
    store.init();
    return fn(store);
  } finally {
    store.close();
  }
}

function isProviderConnected(store: Store, providerId: string): boolean {
  const provider = store.getProvider(providerId);
  return provider?.status === "connected";
}

function optionalAgentSetupStep(baseDir: string): NextStep | null {
  if (isAnyAgentMcpConfigured(baseDir)) {
    return null;
  }
  return {
    label: "Configure MCP access for your coding agent",
    command: `${BINARY_NAME} agent setup`,
    optional: true,
  };
}

function optionalVercelConnectStep(store: Store): NextStep | null {
  if (
    !isProviderConnected(store, "github") ||
    isProviderConnected(store, "vercel")
  ) {
    return null;
  }
  return {
    label: "Connect Vercel to surface GitHub ↔ deployment relationships",
    command: `${BINARY_NAME} connect vercel --use-env`,
    optional: true,
  };
}

function connectSyncLabel(providerId: string): string {
  switch (providerId) {
    case "github":
      return "Discover repositories and workflow runs";
    case "vercel":
      return "Discover projects and deployment evidence";
    case "cloudflare":
      return "Discover workers, databases, KV namespaces, and zones";
    case "sentry":
      return "Discover projects, releases, and issue aggregates";
    case "neon":
      return "Discover Neon projects and operations";
    case "planetscale":
      return "Discover PlanetScale databases";
    default:
      return "Discover resources from the connected provider";
  }
}

function githubRepositoryCount(store: Store): number {
  return store
    .listResources()
    .filter((resource) => resource.provider === "github" && resource.kind === "repository")
    .length;
}

function appendOptionalSteps(
  steps: NextStep[],
  store: Store,
  baseDir: string,
  options?: { vercelWhenEmptyRelationships?: boolean },
): NextStep[] {
  const out = [...steps];
  const vercelStep =
    options?.vercelWhenEmptyRelationships === true
      ? optionalVercelConnectForEmptyGraphStep(store)
      : optionalVercelConnectStep(store);
  if (vercelStep) {
    out.push(vercelStep);
  }
  const agentStep = optionalAgentSetupStep(baseDir);
  if (agentStep) {
    out.push(agentStep);
  }
  return out;
}

function optionalVercelConnectForEmptyGraphStep(store: Store): NextStep | null {
  if (
    !isProviderConnected(store, "github") ||
    isProviderConnected(store, "vercel") ||
    githubRepositoryCount(store) === 0 ||
    store.listRelationships().length > 0
  ) {
    return null;
  }
  return {
    label: "Connect Vercel to surface GitHub ↔ deployment relationships",
    command: `${BINARY_NAME} connect vercel --use-env`,
    optional: true,
  };
}

export function buildConnectNextSteps(
  baseDir: string,
  providerId: string,
): NextStep[] {
  return withStore(baseDir, (store) => {
    const steps: NextStep[] = [
      {
        label: connectSyncLabel(providerId),
        command: `${BINARY_NAME} sync`,
      },
    ];
    return appendOptionalSteps(steps, store, baseDir);
  });
}

export function buildSyncNextSteps(
  baseDir: string,
  sync: SyncNextStepsInput,
): NextStep[] {
  return withStore(baseDir, (store) => {
    const steps: NextStep[] = [];
    if (sync.totalResources > 0) {
      steps.push({
        label: "Browse discovered resources",
        command: `${BINARY_NAME} resources`,
      });
    } else if (sync.ok) {
      steps.push({
        label: "Review connected providers",
        command: `${BINARY_NAME} providers`,
      });
    }

    const githubSyncedOk = sync.results.some(
      (result) => result.providerId === "github" && result.ok,
    );
    return appendOptionalSteps(steps, store, baseDir, {
      vercelWhenEmptyRelationships: githubSyncedOk,
    });
  });
}

export function buildInvestigateNextSteps(
  baseDir: string,
  subjectResourceId: string,
): NextStep[] {
  const saved = listInvestigations(baseDir, { subjectResourceId });
  if (saved.length > 0) {
    return [];
  }
  const steps: NextStep[] = [
    {
      label: "Retain this composition for later comparison",
      command: `${BINARY_NAME} investigate ${subjectResourceId} --save`,
    },
  ];
  const agentStep = optionalAgentSetupStep(baseDir);
  if (agentStep) {
    steps.push(agentStep);
  }
  return steps;
}

export function formatConnectNextSteps(
  baseDir: string,
  providerId: string,
): string {
  return formatNextStepsBlock(buildConnectNextSteps(baseDir, providerId));
}

export function formatSyncNextSteps(
  baseDir: string,
  sync: SyncNextStepsInput,
): string {
  return formatNextStepsBlock(buildSyncNextSteps(baseDir, sync));
}

export function formatInvestigateNextSteps(
  baseDir: string,
  subjectResourceId: string,
): string {
  return formatNextStepsBlock(
    buildInvestigateNextSteps(baseDir, subjectResourceId),
  );
}
