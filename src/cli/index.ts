#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import {
  resolveAgentCombieHome,
  resolveBaseDir,
} from "../storage/paths.ts";
import { CombieError } from "../app/errors.ts";
import { initCombie } from "../app/init.ts";
import { connectProvider } from "../app/connect.ts";
import { syncProviders } from "../app/sync.ts";
import {
  listProviders,
  listResources,
  listRelationships,
  listChanges,
  formatProvidersTable,
  formatResourcesTable,
  formatRelationshipsTable,
  formatChangesTable,
} from "../app/list.ts";
import {
  formatAgentStatusTable,
  formatSkillInstallHint,
  inspectAgents,
  removeAgents,
  resolveAgentBackends,
  setupAgents,
} from "../app/agent.ts";
import { getRelatedContext, formatRelatedContext } from "../app/related.ts";
import { getResourceHistory, formatResourceHistory } from "../app/history.ts";
import { getResourceContext, formatResourceContext } from "../app/context.ts";
import {
  getInvestigationContext,
  formatInvestigationContext,
} from "../app/investigate.ts";
import {
  composeTaskContext,
  normalizeTaskProfile,
} from "../app/task-context.ts";
import {
  formatInvestigationList,
  formatSaveConfirmation,
  formatSavedInvestigation,
  formatWithInvestigationHistory,
  getInvestigationArtifact,
  getSavedInvestigation,
  listInvestigations,
  saveInvestigation,
} from "../app/investigations.ts";
import {
  formatRecordConfirmation,
  formatResolution,
  formatResolutionList,
  formatWithResolutionMemory,
  getResolution,
  listResolutions,
  recordResolution,
} from "../app/resolutions.ts";
import {
  formatIncident,
  formatIncidentAppendConfirmation,
  formatIncidentConfirmation,
  formatIncidentList,
  formatIncidentRemoveConfirmation,
  formatIncidentRetitleConfirmation,
  formatIncidentClearTitleConfirmation,
  formatIncidentRestampConfirmation,
  formatIncidentOccurredAtConfirmation,
  formatWithIncidentMemory,
  getIncident,
  listIncidents,
  listIncidentsFiltered,
  listIncidentsForInvestigation,
  listIncidentsForSubject,
  recordIncident,
  appendIncidentResolutions,
  removeIncidentResolutions,
  retitleIncident,
  clearIncidentTitle,
  restampIncident,
  setIncidentOccurredAt,
  clearIncidentOccurredAt,
  formatIncidentClearOccurredAtConfirmation,
} from "../app/incidents.ts";
import {
  formatIncidentLink,
  formatIncidentLinkConfirmation,
  formatIncidentLinks,
  getIncidentLink,
  listIncidentLinks,
  recordIncidentLink,
} from "../app/incident-links.ts";
import {
  composeIncidentPrecedentMemory,
  composeIncidentPrecedents,
  formatIncidentPrecedents,
} from "../app/incident-precedents.ts";
import {
  compareInvestigationToCurrent,
  formatInvestigationCompare,
} from "../app/compare-investigation.ts";
import {
  composeStructuredResponseMemory,
  formatAction,
  formatActionConfirmation,
  formatActionList,
  formatDecision,
  formatDecisionConfirmation,
  formatDecisionList,
  formatOutcome,
  formatOutcomeConfirmation,
  formatOutcomeList,
  formatRecommendation,
  formatRecommendationConfirmation,
  formatRecommendationList,
  getAction,
  getDecision,
  getOutcome,
  getRecommendation,
  listActions,
  listDecisions,
  listOutcomes,
  listRecommendations,
  recordAction,
  recordDecision,
  recordOutcome,
  recordRecommendation,
} from "../app/structured-response-memory.ts";
import type { DecisionDisposition } from "../domain/decision.ts";
import type { OutcomeAssessment } from "../domain/outcome.ts";
import {
  projectInvestigateResourceLive,
  projectIncidentPrecedentSet,
  projectInvestigationRetrieve,
  projectListInvestigations,
  projectListProviders,
  projectListResources,
  projectRelatedContext,
  projectResourceContext,
  projectTaskContext,
} from "../mcp/projections.ts";
import { safeJson } from "../mcp/serialization.ts";
import { serveMcp } from "../mcp/server.ts";
import { supportedProviderIds } from "../provider/registry.ts";
import { BINARY_NAME, VERSION } from "./constants.ts";
import {
  HELP,
  commandHelp,
  fullHelp,
  helpConflictMessage,
  shortHelp,
  unknownCommandMessage,
  unknownHelpTopicMessage,
} from "./help.ts";

const JSON_COMMANDS = [
  "providers",
  "resources",
  "related",
  "investigate",
  "context",
  "investigations",
  "investigation",
  "precedents",
] as const;
const JSON_USAGE =
  "--json is only available for: providers, resources, related, investigate, context, investigations, investigation, precedents.";

interface ParsedArgs {
  command: string | null;
  positionals: string[];
  flags: Record<string, string | boolean>;
  /** Values of flags repeated across argv, in first-seen order (last value also in `flags`). */
  repeated: Record<string, string[]>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const repeated: Record<string, string[]> = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") {
      flags.help = true;
      continue;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        if (typeof flags[key] === "string") {
          (repeated[key] ??= []).push(flags[key] as string);
        }
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
      continue;
    }
    if (a.startsWith("-") && a.length === 2) {
      flags[a.slice(1)] = true;
      continue;
    }
    positionals.push(a);
  }
  return {
    command: positionals[0] ?? null,
    positionals: positionals.slice(1),
    flags,
    repeated,
  };
}

function baseDirFromFlags(flags: Record<string, string | boolean>): string {
  const dir = flags.dir;
  if (typeof dir === "string" && dir.length > 0) {
    return resolveBaseDir(dir);
  }
  return resolveBaseDir();
}

function formatAgentHomeFallbackDisclosure(home: string): string {
  return `Combie home: ${home}. Run \`${BINARY_NAME} init --dir ${home}\` to create a store there.`;
}

async function confirmAction(prompt: string, yes: boolean): Promise<boolean> {
  if (yes) {
    return true;
  }
  if (!process.stdout.isTTY) {
    return true;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${prompt} [Y/n] `);
    const trimmed = answer.trim().toLowerCase();
    return trimmed === "" || trimmed === "y" || trimmed === "yes";
  } finally {
    rl.close();
  }
}

function optionalFlagId(
  value: string | boolean | undefined,
): string | undefined | "missing" {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return "missing";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "missing";
}

function optionalFlagText(
  value: string | boolean | undefined,
): string | undefined | "missing" {
  return optionalFlagId(value);
}

async function main(argv: string[]): Promise<number> {
  const { command, positionals, flags, repeated } = parseArgs(argv);

  if (command === "help") {
    const topic = positionals[0];
    const all = flags.all === true || typeof flags.all === "string";
    if (all && (topic || typeof flags.all === "string")) {
      console.error(helpConflictMessage());
      return 1;
    }
    if (flags.all === true) {
      console.log(fullHelp().trimEnd());
      return 0;
    }
    if (topic) {
      const page = commandHelp(topic);
      if (!page) {
        console.error(unknownHelpTopicMessage(topic));
        return 1;
      }
      console.log(page.trimEnd());
      return 0;
    }
    console.log(shortHelp().trimEnd());
    return 0;
  }

  if (flags.help === true && command) {
    const page = commandHelp(command);
    if (!page) {
      console.error(unknownHelpTopicMessage(command));
      return 1;
    }
    console.log(page.trimEnd());
    return 0;
  }

  if (command === "version" || flags.version === true) {
    console.log(`combie ${VERSION}`);
    return 0;
  }

  if (!command) {
    console.log(shortHelp().trimEnd());
    return 0;
  }

  if (flags.dir === true) {
    console.error(`--dir requires a path.\nUsage: ${BINARY_NAME} <command> --dir <path>`);
    return 1;
  }

  if (typeof flags.json === "string") {
    console.error(`--json does not take a value.\n${JSON_USAGE}`);
    return 1;
  }

  if (
    flags.json === true &&
    !JSON_COMMANDS.some((jsonCommand) => jsonCommand === command)
  ) {
    console.error(JSON_USAGE);
    return 1;
  }

  if (flags.task !== undefined && command !== "investigate") {
    console.error(
      `--task is only available with investigate.\nUsage: ${BINARY_NAME} investigate <resource-id> --task <profile> --json`,
    );
    return 1;
  }

  const baseDir = baseDirFromFlags(flags);

  try {
    switch (command) {
      case "init": {
        const result = initCombie(baseDir);
        console.log(result.message);
        return result.created ? 0 : 0;
      }
      case "connect": {
        const providerId = positionals[0];
        if (!providerId) {
          const supported = supportedProviderIds().join(", ");
          console.error(
            `Usage: ${BINARY_NAME} connect <provider>\n` +
              `Providers: ${supported}\n` +
              `Example: ${BINARY_NAME} connect github --use-gh`,
          );
          return 1;
        }
        const token = typeof flags.token === "string" ? flags.token : undefined;
        const tokenId =
          typeof flags["token-id"] === "string" ? flags["token-id"] : undefined;
        const organization =
          typeof flags.organization === "string"
            ? flags.organization
            : undefined;
        const useEnvToken = flags["use-env"] === true;
        const useGh = flags["use-gh"] === true;
        const result = await connectProvider({
          baseDir,
          providerId,
          token,
          tokenId,
          organization,
          useEnvToken,
          useGh,
        });
        console.log(result.message);
        return 0;
      }
      case "sync": {
        const providerId = positionals[0];
        const result = await syncProviders({
          baseDir,
          providerId,
        });
        console.log(result.message);
        return result.ok ? 0 : 1;
      }
      case "providers": {
        const { providers } = listProviders(baseDir);
        if (flags.json === true) {
          console.log(
            JSON.stringify(safeJson(projectListProviders(providers)), null, 2),
          );
        } else {
          console.log(formatProvidersTable(providers));
        }
        return 0;
      }
      case "resources": {
        const provider = typeof flags.provider === "string" ? flags.provider : undefined;
        const kind = typeof flags.kind === "string" ? flags.kind : undefined;
        const { resources } = listResources({ baseDir, provider, kind });
        if (flags.json === true) {
          console.log(
            JSON.stringify(safeJson(projectListResources(resources)), null, 2),
          );
        } else {
          console.log(formatResourcesTable(resources));
        }
        return 0;
      }
      case "relationships": {
        const { relationships, labels } = listRelationships(baseDir);
        console.log(formatRelationshipsTable(relationships, labels));
        return 0;
      }
      case "changes": {
        const { changes } = listChanges(baseDir);
        console.log(formatChangesTable(changes));
        return 0;
      }
      case "history": {
        const resourceRef = positionals[0];
        if (!resourceRef) {
          console.error(
            `Usage: ${BINARY_NAME} history <resource-id>\nExample: ${BINARY_NAME} history github:repository:1001\nList ids: ${BINARY_NAME} resources`,
          );
          return 1;
        }
        const history = getResourceHistory({ baseDir, resourceRef });
        console.log(formatResourceHistory(history));
        return 0;
      }
      case "related": {
        const resourceRef = positionals[0];
        if (!resourceRef) {
          console.error(
            `Usage: ${BINARY_NAME} related <resource-id>\nExample: ${BINARY_NAME} related github:repository:1001\nList ids: ${BINARY_NAME} resources`,
          );
          return 1;
        }
        const ctx = getRelatedContext({ baseDir, resourceRef });
        if (flags.json === true) {
          console.log(
            JSON.stringify(safeJson(projectRelatedContext(ctx)), null, 2),
          );
        } else {
          console.log(formatRelatedContext(ctx));
        }
        return 0;
      }
      case "context": {
        const resourceRef = positionals[0];
        if (!resourceRef) {
          console.error(
            `Usage: ${BINARY_NAME} context <resource-id>\nExample: ${BINARY_NAME} context github:repository:1001\nList ids: ${BINARY_NAME} resources`,
          );
          return 1;
        }
        const context = getResourceContext({ baseDir, resourceRef });
        if (flags.json === true) {
          console.log(
            JSON.stringify(safeJson(projectResourceContext(context)), null, 2),
          );
        } else {
          console.log(formatResourceContext(context));
        }
        return 0;
      }
      case "investigate": {
        const resourceRef = positionals[0];
        if (!resourceRef) {
          console.error(
            `Usage: ${BINARY_NAME} investigate <resource-id> [--save]\nExample: ${BINARY_NAME} investigate vercel:project:prj_abc\nList ids: ${BINARY_NAME} resources`,
          );
          return 1;
        }
        const taskValue = flags.task;
        if (taskValue !== undefined) {
          if (typeof taskValue !== "string") {
            console.error(
              `--task requires a profile.\nUsage: ${BINARY_NAME} investigate <resource-id> --task <profile> --json\nProfiles: change-review, dependency-impact, response-recall`,
            );
            return 1;
          }
          if (flags.save === true) {
            console.error(
              `--task is read-only and cannot be combined with --save.\nUse: ${BINARY_NAME} investigate <resource-id> --task <profile> --json`,
            );
            return 1;
          }
          if (flags.json !== true) {
            console.error(
              `--task requires --json in Sprint 109 task mode.\nUsage: ${BINARY_NAME} investigate <resource-id> --task <profile> --json`,
            );
            return 1;
          }
          const profile = normalizeTaskProfile(taskValue.trim());
          const investigation = getInvestigationContext({
            baseDir,
            resourceRef,
          });
          const resolutionRows = listResolutions(baseDir, {
            subjectResourceId: investigation.subject.id,
          });
          const incidentRows = listIncidentsForSubject(
            baseDir,
            investigation.subject.id,
          );
          const investigationRows = listInvestigations(baseDir, {
            subjectResourceId: investigation.subject.id,
          });
          const incidentPrecedentSets =
            profile === "response-recall"
              ? composeIncidentPrecedentMemory(
                  baseDir,
                  incidentRows.map((row) => row.id),
                )
              : [];
          console.log(
            JSON.stringify(
              safeJson(
                projectTaskContext(
                  composeTaskContext({
                    task: profile,
                    ctx: investigation,
                    resolutionRows,
                    incidentRows,
                    investigationRows,
                    structuredResponseChains: composeStructuredResponseMemory(
                      baseDir,
                      investigation.subject.id,
                    ),
                    incidentPrecedentSets,
                  }),
                ),
              ),
              null,
              2,
            ),
          );
          return 0;
        }
        if (flags.json === true && flags.save === true) {
          console.error(
            `--json is read-only observe. Use: ${BINARY_NAME} investigate <resource-id> --save`,
          );
          return 1;
        }
        if (flags.save === true) {
          const saved = saveInvestigation({ baseDir, resourceRef });
          console.log(
            formatWithIncidentMemory(
              formatWithResolutionMemory(
                formatWithInvestigationHistory(
                  saved.liveOutput,
                  listInvestigations(baseDir, {
                    subjectResourceId: saved.record.subjectResourceId,
                  }),
                ),
                listResolutions(baseDir, {
                  subjectResourceId: saved.record.subjectResourceId,
                }),
                "subject",
              ),
              listIncidentsForSubject(
                baseDir,
                saved.record.subjectResourceId,
              ),
              "subject",
            ),
          );
          console.log("");
          console.log(formatSaveConfirmation(saved.record));
          return 0;
        }
        const investigation = getInvestigationContext({
          baseDir,
          resourceRef,
        });
        if (flags.json === true) {
          const resolutionRows = listResolutions(baseDir, {
            subjectResourceId: investigation.subject.id,
          });
          const incidentRows = listIncidentsForSubject(
            baseDir,
            investigation.subject.id,
          );
          const investigationRows = listInvestigations(baseDir, {
            subjectResourceId: investigation.subject.id,
          });
          console.log(
            JSON.stringify(
              safeJson(
                projectInvestigateResourceLive({
                  ctx: investigation,
                  resolutionRows,
                  incidentRows,
                  investigationRows,
                }),
              ),
              null,
              2,
            ),
          );
          return 0;
        }
        console.log(
          formatWithIncidentMemory(
            formatWithResolutionMemory(
              formatWithInvestigationHistory(
                formatInvestigationContext(investigation),
                listInvestigations(baseDir, {
                  subjectResourceId: investigation.subject.id,
                }),
              ),
              listResolutions(baseDir, {
                subjectResourceId: investigation.subject.id,
              }),
              "subject",
            ),
            listIncidentsForSubject(baseDir, investigation.subject.id),
            "subject",
          ),
        );
        return 0;
      }
      case "investigations": {
        const resource =
          typeof flags.resource === "string" ? flags.resource.trim() : undefined;
        if (flags.resource !== undefined && !resource) {
          console.error(
            `--resource requires a resource id.\nUsage: ${BINARY_NAME} investigations [--resource <resource-id>]\nExample: ${BINARY_NAME} investigations --resource github:repository:1001`,
          );
          return 1;
        }
        const records = listInvestigations(
          baseDir,
          resource !== undefined ? { subjectResourceId: resource } : undefined,
        );
        if (flags.json === true) {
          console.log(
            JSON.stringify(safeJson(projectListInvestigations(records)), null, 2),
          );
        } else {
          console.log(formatInvestigationList(records, resource));
        }
        return 0;
      }
      case "investigation": {
        const investigationId = positionals[0];
        if (!investigationId) {
          console.error(
            `Usage: ${BINARY_NAME} investigation <investigation-id> [--compare]\nList ids: ${BINARY_NAME} investigations`,
          );
          return 1;
        }
        if (flags.json === true && flags.compare === true) {
          console.error(
            `--json is read-only observe. Use: ${BINARY_NAME} investigation <investigation-id> --compare`,
          );
          return 1;
        }
        if (flags.compare === true) {
          const comparison = compareInvestigationToCurrent({
            baseDir,
            investigationId,
          });
          console.log(formatInvestigationCompare(comparison));
          return 0;
        }
        const saved = getSavedInvestigation(baseDir, investigationId);
        const artifact = getInvestigationArtifact(baseDir, saved.id);
        if (flags.json === true) {
          console.log(
            JSON.stringify(
              safeJson(projectInvestigationRetrieve(saved, artifact)),
              null,
              2,
            ),
          );
          return 0;
        }
        console.log(
          formatWithIncidentMemory(
            formatWithResolutionMemory(
              formatWithInvestigationHistory(
                formatSavedInvestigation(saved, artifact),
                listInvestigations(baseDir, {
                  subjectResourceId: saved.subjectResourceId,
                }),
              ),
              listResolutions(baseDir, { investigationId: saved.id }),
              "investigation",
            ),
            listIncidentsForInvestigation(baseDir, saved.id),
            "investigation",
          ),
        );
        return 0;
      }
      case "resolution": {
        const investigationFlag = optionalFlagId(flags.investigation);
        if (investigationFlag === "missing") {
          console.error(
            `--investigation requires an investigation id.\nUsage: ${BINARY_NAME} resolution --investigation <investigation-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nUsage: ${BINARY_NAME} resolution --resource <resource-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nUsage: ${BINARY_NAME} resolution --incident <incident-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]`,
          );
          return 1;
        }
        const resourceFlag = optionalFlagId(flags.resource);
        if (resourceFlag === "missing") {
          console.error(
            `--resource requires a resource id.\nUsage: ${BINARY_NAME} resolution --resource <resource-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nUsage: ${BINARY_NAME} resolution --investigation <investigation-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nUsage: ${BINARY_NAME} resolution --incident <incident-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]`,
          );
          return 1;
        }
        const incidentFlag = optionalFlagId(flags.incident);
        if (incidentFlag === "missing") {
          console.error(
            `--incident requires an incident id.\nUsage: ${BINARY_NAME} resolution --incident <incident-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nUsage: ${BINARY_NAME} resolution --investigation <investigation-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nUsage: ${BINARY_NAME} resolution --resource <resource-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]`,
          );
          return 1;
        }
        if ((repeated.incident ?? []).length > 0) {
          console.error(
            `--incident takes one exact id on record.\nUsage: ${BINARY_NAME} resolution --incident <incident-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nUsage: ${BINARY_NAME} resolution --investigation <investigation-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nUsage: ${BINARY_NAME} resolution --resource <resource-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]`,
          );
          return 1;
        }
        const decision = optionalFlagText(flags.decision);
        const action = optionalFlagText(flags.action);
        const outcome = optionalFlagText(flags.outcome);
        if (decision === "missing" || action === "missing" || outcome === "missing") {
          const flag =
            decision === "missing"
              ? "decision"
              : action === "missing"
                ? "action"
                : "outcome";
          console.error(
            `--${flag} requires text.\nUsage: ${BINARY_NAME} resolution --investigation <investigation-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nUsage: ${BINARY_NAME} resolution --resource <resource-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nUsage: ${BINARY_NAME} resolution --incident <incident-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]`,
          );
          return 1;
        }
        const evidenceParts = [
          ...(repeated.evidence ?? []),
          ...(typeof flags.evidence === "string" ? [flags.evidence] : []),
        ];
        if (flags.evidence === true || evidenceParts.some((id) => id.trim().length === 0)) {
          console.error(
            `--evidence requires an evidence id.\nUsage: ${BINARY_NAME} resolution --investigation <investigation-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nUsage: ${BINARY_NAME} resolution --resource <resource-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nUsage: ${BINARY_NAME} resolution --incident <incident-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]`,
          );
          return 1;
        }
        if ((repeated.resource ?? []).length > 0) {
          console.error(
            `--resource takes one exact id on record.\nUsage: ${BINARY_NAME} resolution --resource <resource-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nUsage: ${BINARY_NAME} resolution --incident <incident-id> --resource <resource-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]`,
          );
          return 1;
        }
        if (
          investigationFlag &&
          (resourceFlag !== undefined || incidentFlag !== undefined)
        ) {
          console.error(
            `Use exactly one of --investigation, --resource, or --incident.\nUsage: ${BINARY_NAME} resolution --investigation <investigation-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nUsage: ${BINARY_NAME} resolution --resource <resource-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nUsage: ${BINARY_NAME} resolution --incident <incident-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nUsage: ${BINARY_NAME} resolution --incident <incident-id> --resource <resource-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]`,
          );
          return 1;
        }
        const hasAnchor =
          investigationFlag !== undefined ||
          resourceFlag !== undefined ||
          incidentFlag !== undefined;
        if (hasAnchor) {
          if (positionals[0]) {
            console.error(
              `Usage: ${BINARY_NAME} resolution --investigation <investigation-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nUsage: ${BINARY_NAME} resolution --resource <resource-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nUsage: ${BINARY_NAME} resolution --incident <incident-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nShow: ${BINARY_NAME} resolution <resolution-id>`,
            );
            return 1;
          }
          const recorded = recordResolution({
            baseDir,
            ...(investigationFlag ? { investigationId: investigationFlag } : {}),
            ...(resourceFlag ? { subjectResourceId: resourceFlag } : {}),
            ...(incidentFlag ? { incidentId: incidentFlag } : {}),
            ...(decision ? { decision } : {}),
            ...(action ? { action } : {}),
            ...(outcome ? { outcome } : {}),
            ...(evidenceParts.length > 0 ? { evidenceIds: evidenceParts } : {}),
          });
          console.log(
            formatRecordConfirmation(recorded, incidentFlag ?? undefined),
          );
          return 0;
        }
        const resolutionId = positionals[0];
        if (!resolutionId) {
          console.error(
            `Usage: ${BINARY_NAME} resolution --investigation <investigation-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nUsage: ${BINARY_NAME} resolution --resource <resource-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nUsage: ${BINARY_NAME} resolution --incident <incident-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nShow: ${BINARY_NAME} resolution <resolution-id>\nList ids: ${BINARY_NAME} resolutions`,
          );
          return 1;
        }
        if (decision || action || outcome || evidenceParts.length > 0) {
          console.error(
            `Recording a resolution requires --investigation, --resource, or --incident.\nUsage: ${BINARY_NAME} resolution --investigation <investigation-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nUsage: ${BINARY_NAME} resolution --resource <resource-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]\nUsage: ${BINARY_NAME} resolution --incident <incident-id> --decision <text> [--action <text>] [--outcome <text>] [--evidence <id>]`,
          );
          return 1;
        }
        const record = getResolution(baseDir, resolutionId);
        console.log(formatResolution(record));
        return 0;
      }
      case "resolutions": {
        const investigation =
          optionalFlagId(flags.investigation);
        if (investigation === "missing") {
          console.error(
            `--investigation requires an investigation id.\nUsage: ${BINARY_NAME} resolutions [--investigation <investigation-id>] [--resource <resource-id>] [--evidence <evidence-id>]`,
          );
          return 1;
        }
        const resource =
          typeof flags.resource === "string" ? flags.resource.trim() : undefined;
        if (flags.resource !== undefined && !resource) {
          console.error(
            `--resource requires a resource id.\nUsage: ${BINARY_NAME} resolutions [--investigation <investigation-id>] [--resource <resource-id>] [--evidence <evidence-id>]`,
          );
          return 1;
        }
        const evidence =
          typeof flags.evidence === "string" ? flags.evidence.trim() : undefined;
        if (flags.evidence !== undefined && !evidence) {
          console.error(
            `--evidence requires an evidence id.\nUsage: ${BINARY_NAME} resolutions [--investigation <investigation-id>] [--resource <resource-id>] [--evidence <evidence-id>]`,
          );
          return 1;
        }
        if ((repeated.evidence ?? []).length > 0) {
          console.error(
            `--evidence takes one exact id on the resolutions list.\nUsage: ${BINARY_NAME} resolutions [--investigation <investigation-id>] [--resource <resource-id>] [--evidence <evidence-id>]`,
          );
          return 1;
        }
        const records = listResolutions(baseDir, {
          ...(investigation ? { investigationId: investigation } : {}),
          ...(resource !== undefined ? { subjectResourceId: resource } : {}),
          ...(evidence !== undefined ? { evidenceId: evidence } : {}),
        });
        console.log(
          formatResolutionList(records, {
            ...(investigation ? { investigationId: investigation } : {}),
            ...(resource !== undefined ? { subjectResourceId: resource } : {}),
            ...(evidence !== undefined ? { evidenceId: evidence } : {}),
          }),
        );
        return 0;
      }
      case "incident": {
        if (flags.investigation !== undefined || flags.resource !== undefined) {
          console.error(
            `Recording an incident groups existing --resolution ids; do not pass --investigation or --resource.\nUsage: ${BINARY_NAME} incident --resolution <resolution-id> --resolution <resolution-id> [--title <text>]\nShow: ${BINARY_NAME} incident <incident-id>`,
          );
          return 1;
        }
        const resolutionParts = [
          ...(repeated.resolution ?? []),
          ...(typeof flags.resolution === "string" ? [flags.resolution] : []),
        ];
        const removeParts = [
          ...(repeated["remove-resolution"] ?? []),
          ...(typeof flags["remove-resolution"] === "string"
            ? [flags["remove-resolution"]]
            : []),
        ];
        if (
          flags.resolution === true ||
          resolutionParts.some((id) => id.trim().length === 0)
        ) {
          console.error(
            `--resolution requires a resolution id.\nUsage: ${BINARY_NAME} incident --resolution <resolution-id> --resolution <resolution-id> [--title <text>]`,
          );
          return 1;
        }
        if (
          flags["remove-resolution"] === true ||
          removeParts.some((id) => id.trim().length === 0)
        ) {
          console.error(
            `--remove-resolution requires a resolution id.\nUsage: ${BINARY_NAME} incident <incident-id> --remove-resolution <resolution-id>`,
          );
          return 1;
        }
        const title = optionalFlagText(flags.title);
        if (title === "missing") {
          console.error(
            `--title requires text.\nUsage: ${BINARY_NAME} incident --resolution <resolution-id> --resolution <resolution-id> [--title <text>]\nUsage: ${BINARY_NAME} incident <incident-id> --title <text>`,
          );
          return 1;
        }
        if ((repeated.title ?? []).length > 0) {
          console.error(
            `--title takes one exact title on retitle.\nUsage: ${BINARY_NAME} incident <incident-id> --title <text>`,
          );
          return 1;
        }
        const clearTitleFlag = flags["clear-title"];
        if (typeof clearTitleFlag === "string") {
          console.error(
            `--clear-title does not take a value.\nUsage: ${BINARY_NAME} incident <incident-id> --clear-title`,
          );
          return 1;
        }
        if ((repeated["clear-title"] ?? []).length > 0) {
          console.error(
            `--clear-title takes one flag.\nUsage: ${BINARY_NAME} incident <incident-id> --clear-title`,
          );
          return 1;
        }
        const clearTitle = clearTitleFlag === true;
        const recordedAt = optionalFlagText(flags["recorded-at"]);
        if (recordedAt === "missing") {
          console.error(
            `--recorded-at requires an ISO timestamp.\nUsage: ${BINARY_NAME} incident <incident-id> --recorded-at <iso>`,
          );
          return 1;
        }
        if ((repeated["recorded-at"] ?? []).length > 0) {
          console.error(
            `--recorded-at takes one exact timestamp.\nUsage: ${BINARY_NAME} incident <incident-id> --recorded-at <iso>`,
          );
          return 1;
        }
        const occurredAt = optionalFlagText(flags["occurred-at"]);
        if (occurredAt === "missing") {
          console.error(
            `--occurred-at requires an ISO timestamp.\nUsage: ${BINARY_NAME} incident <incident-id> --occurred-at <iso>`,
          );
          return 1;
        }
        if ((repeated["occurred-at"] ?? []).length > 0) {
          console.error(
            `--occurred-at takes one exact timestamp.\nUsage: ${BINARY_NAME} incident <incident-id> --occurred-at <iso>`,
          );
          return 1;
        }
        const clearOccurredAtFlag = flags["clear-occurred-at"];
        if (typeof clearOccurredAtFlag === "string") {
          console.error(
            `--clear-occurred-at does not take a value.\nUsage: ${BINARY_NAME} incident <incident-id> --clear-occurred-at`,
          );
          return 1;
        }
        if ((repeated["clear-occurred-at"] ?? []).length > 0) {
          console.error(
            `--clear-occurred-at takes one flag.\nUsage: ${BINARY_NAME} incident <incident-id> --clear-occurred-at`,
          );
          return 1;
        }
        const clearOccurredAt = clearOccurredAtFlag === true;
        if (recordedAt && title) {
          console.error(
            `Use --title to retitle or --recorded-at to restamp; not both.\nUsage: ${BINARY_NAME} incident <incident-id> --title <text>\nUsage: ${BINARY_NAME} incident <incident-id> --recorded-at <iso>`,
          );
          return 1;
        }
        if (recordedAt && clearTitle) {
          console.error(
            `Use --clear-title to omit the title or --recorded-at to restamp; not both.\nUsage: ${BINARY_NAME} incident <incident-id> --clear-title\nUsage: ${BINARY_NAME} incident <incident-id> --recorded-at <iso>`,
          );
          return 1;
        }
        if (clearTitle && title) {
          console.error(
            `Use --title to retitle or --clear-title to omit; not both.\nUsage: ${BINARY_NAME} incident <incident-id> --title <text>\nUsage: ${BINARY_NAME} incident <incident-id> --clear-title`,
          );
          return 1;
        }
        if (resolutionParts.length > 0 && removeParts.length > 0) {
          console.error(
            `Use --resolution to append or --remove-resolution to detach; not both.\nUsage: ${BINARY_NAME} incident <incident-id> --resolution <resolution-id>\nUsage: ${BINARY_NAME} incident <incident-id> --remove-resolution <resolution-id>`,
          );
          return 1;
        }
        if (
          recordedAt &&
          (resolutionParts.length > 0 || removeParts.length > 0)
        ) {
          console.error(
            `Use --recorded-at without --resolution or --remove-resolution.\nUsage: ${BINARY_NAME} incident <incident-id> --recorded-at <iso>`,
          );
          return 1;
        }
        if (occurredAt && title) {
          console.error(
            `Use --title to retitle or --occurred-at to set occurrence time; not both.\nUsage: ${BINARY_NAME} incident <incident-id> --title <text>\nUsage: ${BINARY_NAME} incident <incident-id> --occurred-at <iso>`,
          );
          return 1;
        }
        if (occurredAt && clearTitle) {
          console.error(
            `Use --clear-title to omit the title or --occurred-at to set occurrence time; not both.\nUsage: ${BINARY_NAME} incident <incident-id> --clear-title\nUsage: ${BINARY_NAME} incident <incident-id> --occurred-at <iso>`,
          );
          return 1;
        }
        if (occurredAt && recordedAt) {
          console.error(
            `Use --recorded-at to restamp or --occurred-at to set occurrence time; not both.\nUsage: ${BINARY_NAME} incident <incident-id> --recorded-at <iso>\nUsage: ${BINARY_NAME} incident <incident-id> --occurred-at <iso>`,
          );
          return 1;
        }
        if (
          occurredAt &&
          (resolutionParts.length > 0 || removeParts.length > 0)
        ) {
          console.error(
            `Use --occurred-at without --resolution or --remove-resolution.\nUsage: ${BINARY_NAME} incident <incident-id> --occurred-at <iso>`,
          );
          return 1;
        }
        if (clearOccurredAt && occurredAt) {
          console.error(
            `Use --clear-occurred-at to omit occurrence time or --occurred-at to set occurrence time; not both.\nUsage: ${BINARY_NAME} incident <incident-id> --clear-occurred-at\nUsage: ${BINARY_NAME} incident <incident-id> --occurred-at <iso>`,
          );
          return 1;
        }
        if (clearOccurredAt && recordedAt) {
          console.error(
            `Use --recorded-at to restamp or --clear-occurred-at to omit occurrence time; not both.\nUsage: ${BINARY_NAME} incident <incident-id> --recorded-at <iso>\nUsage: ${BINARY_NAME} incident <incident-id> --clear-occurred-at`,
          );
          return 1;
        }
        if (clearOccurredAt && title) {
          console.error(
            `Use --title to retitle or --clear-occurred-at to omit occurrence time; not both.\nUsage: ${BINARY_NAME} incident <incident-id> --title <text>\nUsage: ${BINARY_NAME} incident <incident-id> --clear-occurred-at`,
          );
          return 1;
        }
        if (clearOccurredAt && clearTitle) {
          console.error(
            `Use --clear-title to omit the title or --clear-occurred-at to omit occurrence time; not both.\nUsage: ${BINARY_NAME} incident <incident-id> --clear-title\nUsage: ${BINARY_NAME} incident <incident-id> --clear-occurred-at`,
          );
          return 1;
        }
        if (
          clearOccurredAt &&
          (resolutionParts.length > 0 || removeParts.length > 0)
        ) {
          console.error(
            `Use --clear-occurred-at without --resolution or --remove-resolution.\nUsage: ${BINARY_NAME} incident <incident-id> --clear-occurred-at`,
          );
          return 1;
        }
        if (
          clearTitle &&
          (resolutionParts.length > 0 || removeParts.length > 0)
        ) {
          console.error(
            `Use --clear-title without --resolution or --remove-resolution.\nUsage: ${BINARY_NAME} incident <incident-id> --clear-title`,
          );
          return 1;
        }
        if (removeParts.length > 0) {
          if (!positionals[0]) {
            console.error(
              `--remove-resolution requires an existing incident id.\nUsage: ${BINARY_NAME} incident <incident-id> --remove-resolution <resolution-id>`,
            );
            return 1;
          }
          if (title) {
            console.error(
              `--title is only for recording a new incident grouping.\nUsage: ${BINARY_NAME} incident <incident-id> --remove-resolution <resolution-id>`,
            );
            return 1;
          }
          const result = removeIncidentResolutions({
            baseDir,
            incidentId: positionals[0],
            resolutionIds: removeParts,
          });
          console.log(
            formatIncidentRemoveConfirmation(
              result.record,
              result.removedIds,
            ),
          );
          return 0;
        }
        if (resolutionParts.length > 0) {
          if (positionals[0]) {
            if (title) {
              console.error(
                `--title is only for recording a new incident grouping.\nUsage: ${BINARY_NAME} incident <incident-id> --resolution <resolution-id>`,
              );
              return 1;
            }
            const result = appendIncidentResolutions({
              baseDir,
              incidentId: positionals[0],
              resolutionIds: resolutionParts,
            });
            console.log(
              formatIncidentAppendConfirmation(
                result.record,
                result.appendedIds,
              ),
            );
            return 0;
          }
          const recorded = recordIncident({
            baseDir,
            resolutionIds: resolutionParts,
            ...(title ? { title } : {}),
          });
          console.log(formatIncidentConfirmation(recorded));
          return 0;
        }
        const incidentShowId = positionals[0];
        if (!incidentShowId) {
          if (occurredAt) {
            console.error(
              `--occurred-at requires an existing incident id.\nUsage: ${BINARY_NAME} incident <incident-id> --occurred-at <iso>`,
            );
          } else if (clearOccurredAt) {
            console.error(
              `--clear-occurred-at requires an existing incident id.\nUsage: ${BINARY_NAME} incident <incident-id> --clear-occurred-at`,
            );
          } else if (recordedAt) {
            console.error(
              `--recorded-at requires an existing incident id.\nUsage: ${BINARY_NAME} incident <incident-id> --recorded-at <iso>`,
            );
          } else if (clearTitle) {
            console.error(
              `--clear-title requires an existing incident id.\nUsage: ${BINARY_NAME} incident <incident-id> --clear-title`,
            );
          } else {
            console.error(
              `Usage: ${BINARY_NAME} incident --resolution <resolution-id> --resolution <resolution-id> [--title <text>]\nShow: ${BINARY_NAME} incident <incident-id>\nList ids: ${BINARY_NAME} incidents`,
            );
          }
          return 1;
        }
        if (occurredAt) {
          const updated = setIncidentOccurredAt({
            baseDir,
            incidentId: incidentShowId,
            occurredAt,
          });
          console.log(formatIncidentOccurredAtConfirmation(updated));
          return 0;
        }
        if (clearOccurredAt) {
          const clearedOccurred = clearIncidentOccurredAt({
            baseDir,
            incidentId: incidentShowId,
          });
          console.log(
            formatIncidentClearOccurredAtConfirmation(clearedOccurred),
          );
          return 0;
        }
        if (recordedAt) {
          const restamped = restampIncident({
            baseDir,
            incidentId: incidentShowId,
            recordedAt,
          });
          console.log(formatIncidentRestampConfirmation(restamped));
          return 0;
        }
        if (clearTitle) {
          const cleared = clearIncidentTitle({
            baseDir,
            incidentId: incidentShowId,
          });
          console.log(formatIncidentClearTitleConfirmation(cleared));
          return 0;
        }
        if (title) {
          const renamed = retitleIncident({
            baseDir,
            incidentId: incidentShowId,
            title,
          });
          console.log(formatIncidentRetitleConfirmation(renamed));
          return 0;
        }
        const incident = getIncident(baseDir, incidentShowId);
        console.log(formatIncident(incident));
        return 0;
      }
      case "incidents": {
        const investigationFlag = optionalFlagId(flags.investigation);
        if (investigationFlag === "missing") {
          console.error(
            `--investigation requires an investigation id.\nUsage: ${BINARY_NAME} incidents [--resolution <resolution-id>] [--resource <resource-id>] [--investigation <investigation-id>]`,
          );
          return 1;
        }
        if ((repeated.investigation ?? []).length > 0) {
          console.error(
            `--investigation takes one exact id on the incidents list.\nUsage: ${BINARY_NAME} incidents [--resolution <resolution-id>] [--resource <resource-id>] [--investigation <investigation-id>]`,
          );
          return 1;
        }
        const resolution =
          typeof flags.resolution === "string"
            ? flags.resolution.trim()
            : undefined;
        if (flags.resolution !== undefined && !resolution) {
          console.error(
            `--resolution requires a resolution id.\nUsage: ${BINARY_NAME} incidents [--resolution <resolution-id>] [--resource <resource-id>] [--investigation <investigation-id>]`,
          );
          return 1;
        }
        if ((repeated.resolution ?? []).length > 0) {
          console.error(
            `--resolution takes one exact id on the incidents list.\nUsage: ${BINARY_NAME} incidents [--resolution <resolution-id>] [--resource <resource-id>] [--investigation <investigation-id>]`,
          );
          return 1;
        }
        const resource =
          typeof flags.resource === "string" ? flags.resource.trim() : undefined;
        if (flags.resource !== undefined && !resource) {
          console.error(
            `--resource requires a resource id.\nUsage: ${BINARY_NAME} incidents [--resolution <resolution-id>] [--resource <resource-id>] [--investigation <investigation-id>]`,
          );
          return 1;
        }
        const filter =
          resolution !== undefined ||
          resource !== undefined ||
          investigationFlag !== undefined
            ? {
                ...(resolution !== undefined ? { resolutionId: resolution } : {}),
                ...(resource !== undefined
                  ? { subjectResourceId: resource }
                  : {}),
                ...(investigationFlag !== undefined
                  ? { investigationId: investigationFlag }
                  : {}),
              }
            : undefined;
        const records = filter
          ? listIncidentsFiltered(baseDir, filter)
          : listIncidents(baseDir);
        console.log(formatIncidentList(records, filter));
        return 0;
      }
      case "recommendation": {
        const usage =
          `Usage: ${BINARY_NAME} recommendation --investigation <investigation-id> --action-key <token> --proposal <text>\n` +
          `Usage: ${BINARY_NAME} recommendation --resource <resource-id> --action-key <token> --proposal <text>\n` +
          `Usage: ${BINARY_NAME} recommendation --incident <incident-id> --resource <resource-id> --action-key <token> --proposal <text>`;
        const investigationFlag = optionalFlagId(flags.investigation);
        if (investigationFlag === "missing") {
          console.error(`--investigation requires an investigation id.\n${usage}`);
          return 1;
        }
        if ((repeated.investigation ?? []).length > 0) {
          console.error(`--investigation takes one exact id on record.\n${usage}`);
          return 1;
        }
        const resourceFlag = optionalFlagId(flags.resource);
        if (resourceFlag === "missing") {
          console.error(`--resource requires a resource id.\n${usage}`);
          return 1;
        }
        if ((repeated.resource ?? []).length > 0) {
          console.error(`--resource takes one exact id on record.\n${usage}`);
          return 1;
        }
        const incidentFlag = optionalFlagId(flags.incident);
        if (incidentFlag === "missing") {
          console.error(`--incident requires an incident id.\n${usage}`);
          return 1;
        }
        if ((repeated.incident ?? []).length > 0) {
          console.error(`--incident takes one exact id on record.\n${usage}`);
          return 1;
        }
        const actionKey = optionalFlagText(flags["action-key"]);
        if (actionKey === "missing") {
          console.error(`--action-key requires a token.\n${usage}`);
          return 1;
        }
        const proposal = optionalFlagText(flags.proposal);
        if (proposal === "missing") {
          console.error(`--proposal requires text.\n${usage}`);
          return 1;
        }
        const rationale = optionalFlagText(flags.rationale);
        if (rationale === "missing") {
          console.error(`--rationale requires text.\n${usage}`);
          return 1;
        }
        const evidenceParts = [
          ...(repeated.evidence ?? []),
          ...(typeof flags.evidence === "string" ? [flags.evidence] : []),
        ];
        if (flags.evidence === true || evidenceParts.some((id) => id.trim().length === 0)) {
          console.error(`--evidence requires an evidence id.\n${usage}`);
          return 1;
        }
        const hasAnchor =
          investigationFlag !== undefined ||
          resourceFlag !== undefined ||
          incidentFlag !== undefined;
        if (hasAnchor) {
          if (positionals[0]) {
            console.error(`${usage}\nShow: ${BINARY_NAME} recommendation <recommendation-id>`);
            return 1;
          }
          if (!actionKey) {
            console.error(`--action-key requires a token.\n${usage}`);
            return 1;
          }
          if (!proposal) {
            console.error(`--proposal requires text.\n${usage}`);
            return 1;
          }
          const recorded = recordRecommendation({
            baseDir,
            ...(investigationFlag ? { investigationId: investigationFlag } : {}),
            ...(resourceFlag ? { subjectResourceId: resourceFlag } : {}),
            ...(incidentFlag ? { incidentId: incidentFlag } : {}),
            actionKey,
            proposal,
            ...(rationale ? { rationale } : {}),
            ...(evidenceParts.length > 0 ? { evidenceIds: evidenceParts } : {}),
          });
          console.log(formatRecommendationConfirmation(recorded));
          return 0;
        }
        const recommendationId = positionals[0];
        if (!recommendationId) {
          console.error(
            `${usage}\nShow: ${BINARY_NAME} recommendation <recommendation-id>\nList ids: ${BINARY_NAME} recommendations`,
          );
          return 1;
        }
        if (actionKey || proposal || rationale || evidenceParts.length > 0) {
          console.error(
            `Recording a recommendation requires --investigation, --resource, or --incident.\n${usage}`,
          );
          return 1;
        }
        const record = getRecommendation(baseDir, recommendationId);
        console.log(formatRecommendation(record));
        return 0;
      }
      case "recommendations": {
        const usage = `Usage: ${BINARY_NAME} recommendations [--resource <resource-id>] [--investigation <investigation-id>] [--incident <incident-id>]`;
        const investigationFlag = optionalFlagId(flags.investigation);
        if (investigationFlag === "missing") {
          console.error(`--investigation requires an investigation id.\n${usage}`);
          return 1;
        }
        if ((repeated.investigation ?? []).length > 0) {
          console.error(
            `--investigation takes one exact id on the recommendations list.\n${usage}`,
          );
          return 1;
        }
        const resourceFlag = optionalFlagId(flags.resource);
        if (resourceFlag === "missing") {
          console.error(`--resource requires a resource id.\n${usage}`);
          return 1;
        }
        if ((repeated.resource ?? []).length > 0) {
          console.error(
            `--resource takes one exact id on the recommendations list.\n${usage}`,
          );
          return 1;
        }
        const incidentFlag = optionalFlagId(flags.incident);
        if (incidentFlag === "missing") {
          console.error(`--incident requires an incident id.\n${usage}`);
          return 1;
        }
        if ((repeated.incident ?? []).length > 0) {
          console.error(
            `--incident takes one exact id on the recommendations list.\n${usage}`,
          );
          return 1;
        }
        const filter = {
          ...(resourceFlag ? { subjectResourceId: resourceFlag } : {}),
          ...(investigationFlag ? { investigationId: investigationFlag } : {}),
          ...(incidentFlag ? { incidentId: incidentFlag } : {}),
        };
        const listFilter =
          resourceFlag || investigationFlag || incidentFlag ? filter : undefined;
        const records = listRecommendations(baseDir, listFilter);
        console.log(formatRecommendationList(records, listFilter));
        return 0;
      }
      case "decision": {
        const usage = `Usage: ${BINARY_NAME} decision --recommendation <recommendation-id> --disposition approved|rejected|deferred|modified [--note <text>]`;
        const recommendationFlag = optionalFlagId(flags.recommendation);
        if (recommendationFlag === "missing") {
          console.error(`--recommendation requires a recommendation id.\n${usage}`);
          return 1;
        }
        if ((repeated.recommendation ?? []).length > 0) {
          console.error(`--recommendation takes one exact id on record.\n${usage}`);
          return 1;
        }
        const disposition = optionalFlagText(flags.disposition);
        if (disposition === "missing") {
          console.error(`--disposition requires a value.\n${usage}`);
          return 1;
        }
        const note = optionalFlagText(flags.note);
        if (note === "missing") {
          console.error(`--note requires text.\n${usage}`);
          return 1;
        }
        if (recommendationFlag && disposition) {
          if (positionals[0]) {
            console.error(`${usage}\nShow: ${BINARY_NAME} decision <decision-id>`);
            return 1;
          }
          const recorded = recordDecision({
            baseDir,
            recommendationId: recommendationFlag,
            disposition: disposition as DecisionDisposition,
            ...(note ? { note } : {}),
          });
          console.log(formatDecisionConfirmation(recorded));
          return 0;
        }
        const decisionId = positionals[0];
        if (!decisionId) {
          console.error(
            `${usage}\nShow: ${BINARY_NAME} decision <decision-id>\nList ids: ${BINARY_NAME} decisions`,
          );
          return 1;
        }
        if (recommendationFlag || disposition || note) {
          console.error(
            `Recording a decision requires --recommendation and --disposition.\n${usage}`,
          );
          return 1;
        }
        const record = getDecision(baseDir, decisionId);
        console.log(formatDecision(record));
        return 0;
      }
      case "decisions": {
        const usage = `Usage: ${BINARY_NAME} decisions [--recommendation <recommendation-id>]`;
        const recommendationFlag = optionalFlagId(flags.recommendation);
        if (recommendationFlag === "missing") {
          console.error(`--recommendation requires a recommendation id.\n${usage}`);
          return 1;
        }
        if ((repeated.recommendation ?? []).length > 0) {
          console.error(
            `--recommendation takes one exact id on the decisions list.\n${usage}`,
          );
          return 1;
        }
        const filter = recommendationFlag
          ? { recommendationId: recommendationFlag }
          : undefined;
        const records = listDecisions(baseDir, filter);
        console.log(formatDecisionList(records, filter));
        return 0;
      }
      case "action": {
        const usage = `Usage: ${BINARY_NAME} action --decision <decision-id> --action-key <token> --summary <text> [--performed-at <iso>]`;
        const decisionFlag = optionalFlagId(flags.decision);
        if (decisionFlag === "missing") {
          console.error(`--decision requires a decision id.\n${usage}`);
          return 1;
        }
        if ((repeated.decision ?? []).length > 0) {
          console.error(`--decision takes one exact id on record.\n${usage}`);
          return 1;
        }
        const actionKey = optionalFlagText(flags["action-key"]);
        if (actionKey === "missing") {
          console.error(`--action-key requires a token.\n${usage}`);
          return 1;
        }
        const summary = optionalFlagText(flags.summary);
        if (summary === "missing") {
          console.error(`--summary requires text.\n${usage}`);
          return 1;
        }
        const performedAt = optionalFlagText(flags["performed-at"]);
        if (performedAt === "missing") {
          console.error(`--performed-at requires an ISO timestamp.\n${usage}`);
          return 1;
        }
        if (decisionFlag && actionKey && summary) {
          if (positionals[0]) {
            console.error(`${usage}\nShow: ${BINARY_NAME} action <action-id>`);
            return 1;
          }
          const recorded = recordAction({
            baseDir,
            decisionId: decisionFlag,
            actionKey,
            summary,
            ...(performedAt ? { performedAt } : {}),
          });
          console.log(formatActionConfirmation(recorded));
          return 0;
        }
        const actionId = positionals[0];
        if (!actionId) {
          console.error(
            `${usage}\nShow: ${BINARY_NAME} action <action-id>\nList ids: ${BINARY_NAME} actions`,
          );
          return 1;
        }
        if (decisionFlag || actionKey || summary || performedAt) {
          console.error(
            `Recording an action requires --decision, --action-key, and --summary.\n${usage}`,
          );
          return 1;
        }
        const record = getAction(baseDir, actionId);
        console.log(formatAction(record));
        return 0;
      }
      case "actions": {
        const usage = `Usage: ${BINARY_NAME} actions [--decision <decision-id>]`;
        const decisionFlag = optionalFlagId(flags.decision);
        if (decisionFlag === "missing") {
          console.error(`--decision requires a decision id.\n${usage}`);
          return 1;
        }
        if ((repeated.decision ?? []).length > 0) {
          console.error(`--decision takes one exact id on the actions list.\n${usage}`);
          return 1;
        }
        const filter = decisionFlag ? { decisionId: decisionFlag } : undefined;
        const records = listActions(baseDir, filter);
        console.log(formatActionList(records, filter));
        return 0;
      }
      case "outcome": {
        const usage =
          `Usage: ${BINARY_NAME} outcome --action <action-id> --assessment positive|negative|mixed|neutral|inconclusive --summary <text> [--observed-at <iso>] [--evidence <id>]\n` +
          `Usage: ${BINARY_NAME} outcome --action <action-id> --assessment <assessment> --summary <text> --metric <name> --before <number> --after <number> --unit <unit>`;
        const measurementUsage = `Usage: ${BINARY_NAME} outcome --action <action-id> --assessment <assessment> --summary <text> --metric <name> --before <number> --after <number> --unit <unit>`;
        const actionFlag = optionalFlagId(flags.action);
        if (actionFlag === "missing") {
          console.error(`--action requires an action id.\n${usage}`);
          return 1;
        }
        if ((repeated.action ?? []).length > 0) {
          console.error(`--action takes one exact id on record.\n${usage}`);
          return 1;
        }
        const assessment = optionalFlagText(flags.assessment);
        if (assessment === "missing") {
          console.error(`--assessment requires a value.\n${usage}`);
          return 1;
        }
        const summary = optionalFlagText(flags.summary);
        if (summary === "missing") {
          console.error(`--summary requires text.\n${usage}`);
          return 1;
        }
        const observedAt = optionalFlagText(flags["observed-at"]);
        if (observedAt === "missing") {
          console.error(`--observed-at requires an ISO timestamp.\n${usage}`);
          return 1;
        }
        const evidenceParts = [
          ...(repeated.evidence ?? []),
          ...(typeof flags.evidence === "string" ? [flags.evidence] : []),
        ];
        if (flags.evidence === true || evidenceParts.some((id) => id.trim().length === 0)) {
          console.error(`--evidence requires an evidence id.\n${usage}`);
          return 1;
        }
        const metricRaw = flags.metric;
        const beforeRaw = flags.before;
        const afterRaw = flags.after;
        const unitRaw = flags.unit;
        const anyMeasurement =
          metricRaw !== undefined ||
          beforeRaw !== undefined ||
          afterRaw !== undefined ||
          unitRaw !== undefined;
        const allMeasurement =
          typeof metricRaw === "string" &&
          typeof beforeRaw === "string" &&
          typeof afterRaw === "string" &&
          typeof unitRaw === "string";
        if (anyMeasurement && !allMeasurement) {
          console.error(
            `A measurement requires a non-blank --metric, finite numeric --before and --after, and a non-blank --unit supplied together.\n${measurementUsage}`,
          );
          return 1;
        }
        if (actionFlag && assessment && summary) {
          if (positionals[0]) {
            console.error(`${usage}\nShow: ${BINARY_NAME} outcome <outcome-id>`);
            return 1;
          }
          const recorded = recordOutcome({
            baseDir,
            actionId: actionFlag,
            assessment: assessment as OutcomeAssessment,
            summary,
            ...(observedAt ? { observedAt } : {}),
            ...(allMeasurement
              ? {
                  measurement: {
                    metric: metricRaw,
                    before: Number(beforeRaw),
                    after: Number(afterRaw),
                    unit: unitRaw,
                  },
                }
              : {}),
            ...(evidenceParts.length > 0 ? { evidenceIds: evidenceParts } : {}),
          });
          console.log(formatOutcomeConfirmation(recorded));
          return 0;
        }
        const outcomeId = positionals[0];
        if (!outcomeId) {
          console.error(
            `${usage}\nShow: ${BINARY_NAME} outcome <outcome-id>\nList ids: ${BINARY_NAME} outcomes`,
          );
          return 1;
        }
        if (
          actionFlag ||
          assessment ||
          summary ||
          observedAt ||
          evidenceParts.length > 0 ||
          anyMeasurement
        ) {
          console.error(
            `Recording an outcome requires --action, --assessment, and --summary.\n${usage}`,
          );
          return 1;
        }
        const record = getOutcome(baseDir, outcomeId);
        console.log(formatOutcome(record));
        return 0;
      }
      case "outcomes": {
        const usage = `Usage: ${BINARY_NAME} outcomes [--action <action-id>]`;
        const actionFlag = optionalFlagId(flags.action);
        if (actionFlag === "missing") {
          console.error(`--action requires an action id.\n${usage}`);
          return 1;
        }
        if ((repeated.action ?? []).length > 0) {
          console.error(`--action takes one exact id on the outcomes list.\n${usage}`);
          return 1;
        }
        const filter = actionFlag ? { actionId: actionFlag } : undefined;
        const records = listOutcomes(baseDir, filter);
        console.log(formatOutcomeList(records, filter));
        return 0;
      }
      case "incident-link": {
        const usage =
          `Usage: ${BINARY_NAME} incident-link --incident <incident-id> --incident <incident-id> --reason <text>\n` +
          `Show: ${BINARY_NAME} incident-link <incident-link-id>`;
        const incidentParts = [
          ...(repeated.incident ?? []),
          ...(typeof flags.incident === "string" ? [flags.incident] : []),
        ];
        if (
          flags.incident === true ||
          incidentParts.some((id) => id.trim().length === 0)
        ) {
          console.error(`--incident requires an incident id.\n${usage}`);
          return 1;
        }
        const reason = optionalFlagText(flags.reason);
        if (reason === "missing") {
          console.error(`--reason requires text.\n${usage}`);
          return 1;
        }
        if ((repeated.reason ?? []).length > 0) {
          console.error(`--reason takes one exact claim.\n${usage}`);
          return 1;
        }
        if (incidentParts.length > 0 || reason) {
          if (positionals[0]) {
            console.error(`${usage}`);
            return 1;
          }
          if (!reason) {
            console.error(
              `Recording an incident link requires --reason.\n${usage}`,
            );
            return 1;
          }
          if (incidentParts.length === 0) {
            console.error(
              `Recording an incident link requires --incident twice.\n${usage}`,
            );
            return 1;
          }
          const recorded = recordIncidentLink({
            baseDir,
            incidentIds: incidentParts,
            reason,
          });
          console.log(formatIncidentLinkConfirmation(recorded));
          return 0;
        }
        const linkId = positionals[0];
        if (!linkId) {
          console.error(
            `${usage}\nList ids: ${BINARY_NAME} incident-links`,
          );
          return 1;
        }
        const record = getIncidentLink(baseDir, linkId);
        console.log(formatIncidentLink(record));
        return 0;
      }
      case "incident-links": {
        const usage = `Usage: ${BINARY_NAME} incident-links [--incident <incident-id>]`;
        const incidentFlag = optionalFlagId(flags.incident);
        if (incidentFlag === "missing") {
          console.error(`--incident requires an incident id.\n${usage}`);
          return 1;
        }
        if ((repeated.incident ?? []).length > 0) {
          console.error(
            `--incident takes one exact id on the incident-links list.\n${usage}`,
          );
          return 1;
        }
        const filter = incidentFlag ? { incidentId: incidentFlag } : undefined;
        const records = listIncidentLinks(baseDir, filter);
        console.log(formatIncidentLinks(records, filter));
        return 0;
      }
      case "precedents": {
        const usage = `Usage: ${BINARY_NAME} precedents --incident <incident-id> [--json]`;
        const incidentFlag = optionalFlagId(flags.incident);
        if (incidentFlag === "missing") {
          console.error(`--incident requires an incident id.\n${usage}`);
          return 1;
        }
        if ((repeated.incident ?? []).length > 0) {
          console.error(
            `--incident takes one exact id on precedents.\n${usage}`,
          );
          return 1;
        }
        if (!incidentFlag) {
          console.error(
            `Precedents require --incident.\n${usage}`,
          );
          return 1;
        }
        if (positionals[0]) {
          console.error(usage);
          return 1;
        }
        const set = composeIncidentPrecedents(baseDir, incidentFlag);
        if (flags.json === true) {
          console.log(
            JSON.stringify(
              safeJson(projectIncidentPrecedentSet(set)),
              null,
              2,
            ),
          );
        } else {
          console.log(formatIncidentPrecedents(set));
        }
        return 0;
      }
      case "mcp": {
        await serveMcp({ baseDir });
        return 0;
      }
      case "agent": {
        const agentHome = resolveAgentCombieHome(flags);
        const agentBaseDir = agentHome.baseDir;
        const sub = positionals[0];
        const usage = `Usage: ${BINARY_NAME} agent <setup|status|remove> [agent...]\nAgents: claude, codex, cursor`;
        if (!sub) {
          console.error(usage);
          return 1;
        }
        if (sub === "status") {
          const statuses = inspectAgents(agentBaseDir);
          console.log(formatAgentStatusTable(statuses));
          return 0;
        }
        if (sub === "setup") {
          const names = positionals.length > 1 ? positionals.slice(1) : null;
          const planned = resolveAgentBackends(names);
          const configured = new Set(
            inspectAgents(agentBaseDir)
              .filter((s) => s.status === "configured")
              .map((s) => s.kind),
          );
          const toConfigure = planned.filter((b) => !configured.has(b.kind));
          if (toConfigure.length === 0) {
            console.log("All requested agents are already configured.");
            console.log(formatSkillInstallHint());
            return 0;
          }
          const ok = await confirmAction(
            `Configure MCP access for ${toConfigure.map((b) => b.label).join(", ")}?`,
            flags.yes === true,
          );
          if (!ok) {
            console.log("Skipped. No changes made.");
            return 0;
          }
          if (agentHome.usedHomeFallback) {
            console.log(formatAgentHomeFallbackDisclosure(agentBaseDir));
          }
          const results = setupAgents(names, agentBaseDir);
          for (const result of results) {
            console.log(result.message);
          }
          console.log(formatSkillInstallHint());
          return 0;
        }
        if (sub === "remove") {
          const names = positionals.slice(1);
          if (names.length === 0) {
            console.error(
              `Usage: ${BINARY_NAME} agent remove <agent...>\nAgents: claude, codex, cursor`,
            );
            return 1;
          }
          const backends = resolveAgentBackends(names);
          const ok = await confirmAction(
            `Remove Combie MCP access from ${backends.map((b) => b.label).join(", ")}?`,
            flags.yes === true,
          );
          if (!ok) {
            console.log("Skipped. No changes made.");
            return 0;
          }
          const results = removeAgents(names);
          for (const result of results) {
            console.log(result.message);
          }
          return 0;
        }
        console.error(`Unknown agent command: ${sub}\n${usage}`);
        return 1;
      }
      default:
        console.error(unknownCommandMessage(command));
        return 1;
    }
  } catch (err) {
    if (err instanceof CombieError) {
      console.error(err.message);
      return err.exitCode;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    return 1;
  }
}

if (import.meta.main) {
  const code = await main(process.argv.slice(2));
  process.exit(code);
}

export { main, parseArgs, HELP };
