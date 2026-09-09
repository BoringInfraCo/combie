import type { Resource, ResourceKind } from "../domain/resource.ts";
import { randomUUID } from "node:crypto";
import { Store } from "../storage/store.ts";
import { CredentialsStore } from "../storage/credentials.ts";
import { getProvider } from "../provider/registry.ts";
import {
  notInitialized,
  providerNotConnected,
  CombieError,
} from "./errors.ts";
import { BINARY_NAME } from "../cli/constants.ts";
import { formatSyncNextSteps } from "./next-steps.ts";
import {
  inferGitHubVercelRelationships,
  isGitHubVercelSourceFor,
} from "./infer-github-vercel.ts";
import {
  inferGitHubSentryRelationships,
  isGitHubSentryCodeMappedTo,
} from "./infer-github-sentry.ts";
import {
  hasAuthoritativeDomainEvidence,
  inferVercelCloudflareRelationships,
  isVercelCloudflareUsesDomainIn,
} from "./infer-vercel-cloudflare.ts";
import { syncGitHubIssues } from "./github-issues.ts";
import { syncGitHubWorkflowRuns } from "./github-workflow-runs.ts";
import { syncNeonOperations } from "./neon-operations.ts";
import { syncSentryCodeMappings } from "./sentry-code-mappings.ts";
import { syncSentryIssues } from "./sentry-issues.ts";
import { syncSentryReleases } from "./sentry-releases.ts";
import { syncVercelDeployments } from "./vercel-deployments.ts";
import { parseCodeMappingRefresh } from "../providers/sentry/code-mapping.ts";

export interface SyncOptions {
  baseDir: string;
  /** When omitted, sync all connected providers. */
  providerId?: string;
}

export interface SyncProviderResult {
  provider: string;
  providerId: string;
  ok: boolean;
  counts: Partial<Record<ResourceKind, number>>;
  total: number;
  /** Resource ids discovered by this run's successful sync. */
  discoveredResourceIds: string[];
  /** Vercel projects whose domain enrichment was authoritative this run. */
  authoritativeDomainResourceIds: string[];
  message: string;
  error?: string;
}

export interface RelationshipSyncSummary {
  /** Whether this resolver refreshed (both required providers succeeded). */
  refreshed: boolean;
  inferred: number;
  removed: number;
  /** Content lines without the shared "Relationships:" header. */
  message: string;
}

export interface SyncResult {
  results: SyncProviderResult[];
  /** True when every attempted provider succeeded. */
  ok: boolean;
  message: string;
  totalResources: number;
  relationships?: RelationshipSyncSummary;
  domainRelationships?: RelationshipSyncSummary;
  codeMappingRelationships?: RelationshipSyncSummary;
}

function countByKind(resources: Resource[]): Partial<Record<ResourceKind, number>> {
  const counts: Partial<Record<ResourceKind, number>> = {};
  for (const r of resources) {
    counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  }
  return counts;
}

/**
 * Optional-enrichment metadata keys per provider resource. When a provider's
 * enrichment call fails, the key is omitted (unknown) rather than set to
 * empty. Listing the key here preserves the previously observed value instead
 * of converting unknown evidence into a false removal/Change.
 */
function preserveMissingMetadataKeysFor(
  resource: Resource,
): string[] | undefined {
  if (resource.provider === "planetscale" && resource.kind === "database") {
    return ["branches"];
  }
  if (resource.kind !== "project") return undefined;
  if (resource.provider === "vercel") return ["domains"];
  if (resource.provider === "sentry") {
    return ["codeMappings", "codeMappingRefresh"];
  }
  if (resource.provider === "neon") return ["branches", "databases", "endpoints"];
  return undefined;
}

function formatKindLabel(kind: ResourceKind, n: number): string {
  const labels: Record<ResourceKind, [string, string]> = {
    worker: ["Worker", "Workers"],
    // Generic: Cloudflare D1 and PlanetScale both use kind `database`.
    database: ["database", "databases"],
    kv_namespace: ["KV namespace", "KV namespaces"],
    zone: ["zone", "zones"],
    repository: ["repository", "repositories"],
    project: ["project", "projects"],
  };
  const [one, many] = labels[kind];
  return `${n} ${n === 1 ? one : many}`;
}

async function syncOne(
  store: Store,
  baseDir: string,
  providerId: string,
): Promise<SyncProviderResult> {
  const record = store.getProvider(providerId);
  if (!record || record.status !== "connected") {
    throw providerNotConnected(providerId);
  }

  const provider = getProvider(providerId);
  if (!provider) {
    throw providerNotConnected(providerId);
  }

  const creds = new CredentialsStore(baseDir);
  const token = creds.getCredential(providerId);
  if (!token) {
    throw new CombieError(
      "MISSING_CREDENTIALS",
      `No credentials found for ${providerId}.\nRun: ${BINARY_NAME} connect ${providerId}`,
    );
  }

  const config = record.config ?? {};
  let accountId =
    typeof config.accountId === "string" ? config.accountId : undefined;

  if (!accountId) {
    const auth = await provider.authenticate(token);
    if (!auth.ok) {
      throw new CombieError(
        "AUTH_FAILED",
        `${provider.name} authentication failed: ${auth.message}`,
      );
    }
    accountId = auth.accountId;
    if (!accountId) {
      throw new CombieError(
        "NO_ACCOUNT",
        `${provider.name} authentication succeeded but no account identity was returned.\nReconnect with: ${BINARY_NAME} connect ${providerId}`,
      );
    }
    store.upsertProvider({
      ...record,
      config: {
        ...config,
        accountId,
        accountName: auth.accountName ?? config.accountName ?? null,
      },
    });
  }

  let discovered;
  try {
    discovered = await provider.discoverResources(token, { accountId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CombieError(
      "DISCOVER_FAILED",
      `${provider.name} sync failed: ${msg}`,
    );
  }

  const now = new Date().toISOString();
  const authoritativeDomainResourceIds = discovered.resources
    .filter(
      (resource) =>
        resource.provider === "vercel" &&
        resource.kind === "project" &&
        hasAuthoritativeDomainEvidence(resource),
    )
    .map((resource) => resource.id);
  for (const resource of discovered.resources) {
    store.applyResource(resource, {
      id: randomUUID(),
      observedAt: now,
      preserveMissingMetadataKeys: preserveMissingMetadataKeysFor(resource),
    });
  }

  // Provider-native historical evidence is separate from Resource metadata/Changes.
  // Retrieval failure must not undo successful Resource discovery.
  const evidenceLines: string[] = [];
  if (providerId === "vercel") {
    const deploymentSync = await syncVercelDeployments({
      store,
      token,
      projects: discovered.resources,
      observedAt: now,
    });
    evidenceLines.push(...deploymentSync.lines);
  }
  if (providerId === "github") {
    const workflowSync = await syncGitHubWorkflowRuns({
      store,
      token,
      repositories: discovered.resources,
      observedAt: now,
    });
    evidenceLines.push(...workflowSync.lines);
    const issueSync = await syncGitHubIssues({
      store,
      token,
      repositories: discovered.resources,
      observedAt: now,
    });
    evidenceLines.push(...issueSync.lines);
  }
  if (providerId === "neon") {
    const operationSync = await syncNeonOperations({
      store,
      token,
      projects: discovered.resources,
      observedAt: now,
    });
    evidenceLines.push(...operationSync.lines);
  }
  if (providerId === "sentry") {
    const releaseSync = await syncSentryReleases({
      store,
      token,
      projects: discovered.resources,
      observedAt: now,
    });
    evidenceLines.push(...releaseSync.lines);
    const issueSync = await syncSentryIssues({
      store,
      token,
      projects: discovered.resources,
      observedAt: now,
    });
    evidenceLines.push(...issueSync.lines);
    const mappingSync = await syncSentryCodeMappings({
      store,
      token,
      projects: discovered.resources,
      observedAt: now,
    });
    evidenceLines.push(...mappingSync.lines);
  }

  store.setLastSync(providerId, now);
  store.setLastAttempt(providerId, now);
  store.setLastDiscoveryResourceIds(
    providerId,
    discovered.resources.map((r) => r.id),
  );

  const counts = countByKind(discovered.resources);
  const lines = (Object.keys(counts) as ResourceKind[])
    .filter((k) => (counts[k] ?? 0) > 0)
    .map((k) => formatKindLabel(k, counts[k]!));

  const discoveredBlock =
    lines.length > 0
      ? `Discovered:\n${lines.map((l) => `  ${l}`).join("\n")}`
      : "Discovered:\n  (no supported resources found)";

  const evidenceBlock =
    evidenceLines.length > 0
      ? `\n${evidenceLines.map((l) => `  ${l}`).join("\n")}`
      : "";

  const message =
    `Syncing ${provider.name}...\n` +
    `✓ ${discovered.resources.length} resource${discovered.resources.length === 1 ? "" : "s"}\n` +
    `${discoveredBlock}` +
    evidenceBlock;

  return {
    provider: provider.name,
    providerId,
    ok: true,
    counts,
    total: discovered.resources.length,
    discoveredResourceIds: discovered.resources.map((r) => r.id),
    authoritativeDomainResourceIds,
    message,
  };
}

/**
 * Discover, normalize, and upsert resources for connected providers.
 *
 * Multi-provider behavior:
 * - attempt each configured provider
 * - persist successful results
 * - report failures clearly
 * - ok=false when any provider fails
 */
export async function syncProviders(options: SyncOptions): Promise<SyncResult> {
  const store = new Store(options.baseDir);
  try {
    if (!store.isInitialized()) {
      throw notInitialized();
    }
    store.init();

    const providers = options.providerId
      ? [options.providerId.toLowerCase()]
      : store
          .listProviders()
          .filter((p) => p.status === "connected")
          .map((p) => p.id);

    if (providers.length === 0) {
      throw new CombieError(
        "NO_PROVIDERS",
        `No connected providers to sync.\nRun: ${BINARY_NAME} connect cloudflare\nor: ${BINARY_NAME} connect github\nor: ${BINARY_NAME} connect vercel\nor: ${BINARY_NAME} connect sentry\nor: ${BINARY_NAME} connect neon\nor: ${BINARY_NAME} connect planetscale`,
      );
    }

    const results: SyncProviderResult[] = [];

    for (const id of providers) {
      try {
        results.push(await syncOne(store, options.baseDir, id));
      } catch (err) {
        // Stamp only when the provider row exists. A missing row is not a
        // sync try — setLastAttempt would throw and hide the original error.
        if (store.getProvider(id)) {
          store.setLastAttempt(id, new Date().toISOString());
        }
        const provider = getProvider(id);
        const name = provider?.name ?? id;
        const errorMessage =
          err instanceof CombieError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        results.push({
          provider: name,
          providerId: id,
          ok: false,
          counts: {},
          total: 0,
          discoveredResourceIds: [],
          authoritativeDomainResourceIds: [],
          message: `Syncing ${name}...\n✗ failed`,
          error: errorMessage,
        });
      }
    }

    const ok = results.every((r) => r.ok);
    const totalResources = results
      .filter((r) => r.ok)
      .reduce((sum, r) => sum + r.total, 0);

    const parts: string[] = [];
    for (const r of results) {
      parts.push(r.message);
      if (r.error) {
        parts.push(r.error);
      }
    }

    const relationships = refreshGitHubVercelRelationships(store, results);
    const domainRelationships = refreshVercelCloudflareRelationships(
      store,
      results,
    );
    const codeMappingRelationships = refreshGitHubSentryRelationships(
      store,
      results,
    );

    const relationshipLines = [
      relationships,
      domainRelationships,
      codeMappingRelationships,
    ]
      .filter((s) => s.message.length > 0)
      .flatMap((s) => s.message.split("\n"));
    if (relationshipLines.length > 0) {
      parts.push(
        `Relationships:\n${relationshipLines.map((l) => `  ${l}`).join("\n")}`,
      );
    }

    const summary =
      results.length > 1
        ? `\nSync ${ok ? "complete" : "finished with errors"}.\n${totalResources} resources stored from successful providers.`
        : results[0]?.ok
          ? `\n${results[0].total} resources stored.`
          : "";
    const next = formatSyncNextSteps(options.baseDir, {
      results,
      ok,
      totalResources,
    });

    return {
      results,
      ok,
      totalResources,
      relationships,
      domainRelationships,
      codeMappingRelationships,
      message: parts.join("\n\n") + summary + next,
    };
  } finally {
    store.close();
  }
}

/**
 * Refresh GitHub↔Vercel source_for Relationships only when both providers
 * succeeded in this sync run (complete evidence). Incomplete evidence never
 * triggers destructive stale cleanup.
 */
function refreshGitHubVercelRelationships(
  store: Store,
  results: SyncProviderResult[],
): RelationshipSyncSummary {
  const githubResult = results.find((r) => r.providerId === "github");
  const vercelResult = results.find((r) => r.providerId === "vercel");

  // Both providers must have been attempted and succeeded this run.
  if (!githubResult?.ok || !vercelResult?.ok) {
    return {
      refreshed: false,
      inferred: 0,
      removed: 0,
      message: "",
    };
  }

  const resources = store.listResources();
  const inferred = inferGitHubVercelRelationships(resources);
  const inferredIds = new Set(inferred.map((r) => r.id));

  for (const rel of inferred) {
    store.upsertRelationship(rel);
  }

  const existing = store.listRelationships().filter(isGitHubVercelSourceFor);
  const staleIds = existing
    .filter((r) => !inferredIds.has(r.id))
    .map((r) => r.id);
  const removed = store.deleteRelationshipsByIds(staleIds);

  const n = inferred.length;
  const lines =
    n === 0
      ? ["0 GitHub → Vercel source_for (no deterministic matches)"]
      : [`${n} GitHub → Vercel source_for`];
  if (removed > 0) {
    lines.push(
      `${removed} stale relationship${removed === 1 ? "" : "s"} removed`,
    );
  }

  return {
    refreshed: true,
    inferred: n,
    removed,
    message: lines.join("\n"),
  };
}

/**
 * Refresh Vercel↔Cloudflare uses_domain_in Relationships only when both
 * providers succeeded in this sync run. Stale cleanup is scoped to this
 * resolver's edges and only proceeds for projects with authoritative domain
 * evidence: `domains: []` (known empty) or a current non-matching domain set.
 * Projects whose enrichment is unknown (omitted `domains`) keep prior edges.
 * Never touches `source_for`.
 */
function refreshVercelCloudflareRelationships(
  store: Store,
  results: SyncProviderResult[],
): RelationshipSyncSummary {
  const vercelResult = results.find((r) => r.providerId === "vercel");
  const cloudflareResult = results.find((r) => r.providerId === "cloudflare");

  if (!vercelResult?.ok || !cloudflareResult?.ok) {
    return {
      refreshed: false,
      inferred: 0,
      removed: 0,
      message: "",
    };
  }

  const resources = store.listResources();

  // Zones discovered this run are live; persisted zone Resources outside this
  // set are authoritatively absent (Combie does not delete stale Resources).
  // Edges supported only by stale zone Resources are never (re)created.
  const liveResourceIds = new Set(cloudflareResult.discoveredResourceIds);
  const authoritativeProjectIds = new Set(
    vercelResult.authoritativeDomainResourceIds,
  );
  const inferred = inferVercelCloudflareRelationships(resources).filter(
    (r) =>
      authoritativeProjectIds.has(r.sourceResourceId) &&
      liveResourceIds.has(r.targetResourceId),
  );
  const inferredIds = new Set(inferred.map((r) => r.id));

  for (const rel of inferred) {
    store.upsertRelationship(rel);
  }

  const existing = store
    .listRelationships()
    .filter(isVercelCloudflareUsesDomainIn);
  const staleIds = existing
    .filter((r) => !inferredIds.has(r.id))
    .filter(
      (r) =>
        // Zone authoritatively absent: the edge cannot hold without it.
        !liveResourceIds.has(r.targetResourceId) ||
        // Supported zones: clean up only with authoritative domain evidence.
        authoritativeProjectIds.has(r.sourceResourceId),
    )
    .map((r) => r.id);
  const removed = store.deleteRelationshipsByIds(staleIds);

  const n = inferred.length;
  const lines =
    n === 0
      ? ["0 Vercel → Cloudflare uses_domain_in (no deterministic matches)"]
      : [`${n} Vercel → Cloudflare uses_domain_in`];
  if (removed > 0) {
    lines.push(
      `${removed} stale relationship${removed === 1 ? "" : "s"} removed`,
    );
  }

  return {
    refreshed: true,
    inferred: n,
    removed,
    message: lines.join("\n"),
  };
}

function hasSuccessfulMappingRefresh(resource: Resource): boolean {
  const refresh = parseCodeMappingRefresh(resource.metadata.codeMappingRefresh);
  return (
    refresh?.status === "success" && Array.isArray(resource.metadata.codeMappings)
  );
}

/**
 * Refresh GitHub↔Sentry code_mapped_to Relationships only when both
 * providers succeeded in this sync run. Stale cleanup is scoped to this
 * resolver's edges and only proceeds for projects with a successful mapping
 * refresh (`codeMappings` present, including `[]`). Projects whose mapping
 * enrichment is unknown keep prior edges. Never touches `source_for` or
 * `uses_domain_in`.
 */
function refreshGitHubSentryRelationships(
  store: Store,
  results: SyncProviderResult[],
): RelationshipSyncSummary {
  const githubResult = results.find((r) => r.providerId === "github");
  const sentryResult = results.find((r) => r.providerId === "sentry");

  if (!githubResult?.ok || !sentryResult?.ok) {
    return {
      refreshed: false,
      inferred: 0,
      removed: 0,
      message: "",
    };
  }

  const resources = store.listResources();
  const liveRepoIds = new Set(githubResult.discoveredResourceIds);
  const authoritativeProjectIds = new Set(
    resources
      .filter(
        (r) =>
          r.provider === "sentry" &&
          r.kind === "project" &&
          sentryResult.discoveredResourceIds.includes(r.id) &&
          hasSuccessfulMappingRefresh(r),
      )
      .map((r) => r.id),
  );

  const inferred = inferGitHubSentryRelationships(resources).filter(
    (r) =>
      liveRepoIds.has(r.sourceResourceId) &&
      authoritativeProjectIds.has(r.targetResourceId),
  );
  const inferredIds = new Set(inferred.map((r) => r.id));

  for (const rel of inferred) {
    store.upsertRelationship(rel);
  }

  const existing = store.listRelationships().filter(isGitHubSentryCodeMappedTo);
  const staleIds = existing
    .filter((r) => !inferredIds.has(r.id))
    .filter(
      (r) =>
        !liveRepoIds.has(r.sourceResourceId) ||
        authoritativeProjectIds.has(r.targetResourceId),
    )
    .map((r) => r.id);
  const removed = store.deleteRelationshipsByIds(staleIds);

  const n = inferred.length;
  const lines =
    n === 0
      ? ["0 GitHub → Sentry code_mapped_to (no deterministic matches)"]
      : [`${n} GitHub → Sentry code_mapped_to`];
  if (removed > 0) {
    lines.push(
      `${removed} stale relationship${removed === 1 ? "" : "s"} removed`,
    );
  }

  return {
    refreshed: true,
    inferred: n,
    removed,
    message: lines.join("\n"),
  };
}
