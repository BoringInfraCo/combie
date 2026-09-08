import { BINARY_NAME } from "./constants.ts";

const FULL_HELP_TEMPLATE = `combie — engineering context layer

Usage:
  ${BINARY_NAME} <command> [options]

Commands:
  init                         Initialize local Combie state
  connect <provider>           Connect a provider (cloudflare, github, vercel, sentry, neon, planetscale)
  sync [provider]              Discover and store resources
  providers                    List configured providers
                               LAST SYNC is last successful sync; LAST ATTEMPT
                               is shown when a later try failed
  resources                    List discovered resources
  relationships                List known cross-provider relationships
  changes                      List observed Resource changes
  history <resource-id>        Show current state and observed history
  related <resource-id>        Show one-hop related context for a resource
  context <resource-id>        Compose current, related, and Change context
  investigate <resource-id>    Compose one-hop investigation context around a resource
  investigations               List saved investigation snapshots
  investigation <id>           Reopen a saved investigation snapshot (--compare: diff against current compose)
  resolution                   Record or show an explicit investigation resolution
  resolutions                  List retained resolution records
  incident                     Record, show, add, or remove members of an explicit incident grouping of resolutions
  incidents                    List retained incident groupings
  incident-link                Record or show an explicit organizational link between two incidents
  incident-links               List retained incident links
  precedents                   Retrieve explicit and candidate precedents for one incident
  recommendation               Record or show an explicit recommendation
  recommendations              List retained recommendation records
  decision                     Record or show an explicit decision on a recommendation
  decisions                    List retained decision records
  action                       Record or show an explicit attempted response
  actions                      List retained action records
  outcome                      Record or show an explicit outcome assessment
  outcomes                     List retained outcome records
  mcp                          Start read-only MCP server over stdio
  agent status                 Show MCP integration status for claude, codex, cursor
  agent setup [agent...]       Configure MCP access for agents (default: all supported)
  agent remove <agent...>      Remove Combie MCP access from agent configs
  version                      Show build version
  help                         Show this help

Connect options:
  --token <token>              API token (avoid in shared shells; prefer --use-env / --use-gh)
  --token-id <id>              PlanetScale service-token ID (use with --token secret)
  --organization <slug>        PlanetScale organization when the token sees multiple orgs
  --use-env                    Use provider token from the environment
                               cloudflare: CLOUDFLARE_API_TOKEN
                               github: GITHUB_TOKEN or GH_TOKEN
                               vercel: VERCEL_TOKEN
                               sentry: SENTRY_AUTH_TOKEN or SENTRY_TOKEN
                               neon: NEON_API_KEY
                               planetscale: PLANETSCALE_SERVICE_TOKEN_ID + PLANETSCALE_SERVICE_TOKEN
  --use-gh                     GitHub only: reuse authenticated GitHub CLI (\`gh auth token\`)

Resources options:
  --provider <id>              Filter by provider
  --kind <kind>                Filter by kind (worker, database, kv_namespace, zone, repository, project)

Read options:
  --json                       Emit structured JSON for providers, resources,
                               related, investigate, context, investigations,
                               investigation <id>, or precedents

Investigate options:
  --save                       Persist a retained investigation snapshot
  --task <profile>             With "investigate" + --json: select a task-scoped
                               view (change-review | dependency-impact | response-recall)
  --compare                    With "investigation <id>": compare snapshot to current compose
  --resource <resource-id>     With "investigations": list snapshots for one subject
                               With "resolutions": list resolutions for one subject
                               With "resolution": resource to record against (no saved investigation), or with --incident the subject of the new row (must already be a member subject)
                               With "incidents": list groupings with a member Resolution on one subject
                               With "recommendation": resource to record against, or with --incident the named member subject
                               With "recommendations": list recommendations for one subject
  --investigation <id>         With "resolution": investigation to record against
                               With "resolutions": list resolutions for one investigation
                               With "incidents": list groupings with a member Resolution recorded against that investigation (membership only; one exact id)
                               With "recommendation": investigation to record against
                               With "recommendations": list recommendations for one investigation
  --incident <incident-id>     With "resolution": existing incident grouping to record
                               against (subject copied from members, or named with --resource; one exact id)
                               With "recommendation": existing incident grouping to record against (requires --resource)
                               With "recommendations": list recommendations for one incident
                               With "incident-link": exact Incident id to link (repeatable; exactly two distinct)
                               With "incident-links": list links that name that exact Incident id
                               With "precedents": exact query Incident id (one required)
  --reason <text>              With "incident-link": required organizational claim for the link
  --decision <text>            Explicit decision (what you decided)
                               With "action": parent decision to record against
                               With "actions": list actions for one decision
  --action <text>              Explicit action (what you actually did)
                               With "outcome": parent action to record against
                               With "outcomes": list outcomes for one action
  --outcome <text>             Explicit outcome (what happened afterward)
  --evidence <id>              Attach an exact local evidence id (optional, repeatable; never inferred)
                               With "resolutions": list retained resolutions that attached that exact local id (membership only; one exact id)
                               With "recommendation" / "outcome": attach exact local evidence ids at record time (repeatable)
  --recommendation <id>        With "decision": parent recommendation to record against
                               With "decisions": list decisions for one recommendation
  --action-key <token>         Lower-kebab response category (recommendation / action)
  --proposal <text>            Explicit proposed response
  --rationale <text>           Optional recommendation rationale
  --disposition <value>        approved, rejected, deferred, or modified
  --note <text>                Optional decision note (required when disposition is modified)
  --summary <text>             Explicit action or outcome summary
  --performed-at <iso>         With "action": named attempt time (omit means unknown)
  --assessment <value>         positive, negative, mixed, neutral, or inconclusive
  --observed-at <iso>          With "outcome": named observation time (omit means unknown)
  --metric <name>              With "outcome": measurement metric (atomic with --before/--after/--unit)
  --before <number>            With "outcome": measurement before (finite number; atomic)
  --after <number>             With "outcome": measurement after (finite number; atomic)
  --unit <unit>                With "outcome": measurement unit (atomic)
  --resolution <resolution-id> With "incident": exact Resolution id to group at create (repeatable), or to append to incident <id>
                               With "incidents": list groupings that named that exact resolution id (membership only; one exact id)
  --remove-resolution <resolution-id> With "incident <id>": exact current member Resolution id to detach (repeatable; remaining members must stay ≥2)
  --title <text>               Optional name for an incident grouping at create, or to retitle incident <id>
  --clear-title                With "incident <id>": omit the stored title (members and recordedAt unchanged)
  --recorded-at <iso>          With "incident <id>": replace recordedAt (title and members unchanged)
  --occurred-at <iso>          With "incident <id>": set occurredAt (recordedAt, title, and members unchanged)
  --clear-occurred-at           With "incident <id>": omit the stored occurredAt (recordedAt, title, and members unchanged)

Investigation history appears on investigate and investigation reopen
when snapshots exist.
Resolution memory appears on investigate and investigation reopen
when records exist, including the recorded text.
Incident memory appears on those same paths when groupings exist.

Resource references:
  <resource-id>                Stable id: provider:kind:providerResourceId
                               Example: github:repository:1001

Global:
  --dir <path>                 Combie state directory (default: ./.combie)
  --yes                        Skip confirmation prompts (non-interactive)
  --help, -h                   Show help
  --version                    Show build version

Examples:
  ${BINARY_NAME} init
  ${BINARY_NAME} connect cloudflare --use-env
  ${BINARY_NAME} connect github --use-gh
  ${BINARY_NAME} connect vercel --use-env
  ${BINARY_NAME} connect sentry --use-env
  ${BINARY_NAME} connect neon --use-env
  ${BINARY_NAME} connect planetscale --use-env
  ${BINARY_NAME} connect planetscale --organization acme --use-env
  ${BINARY_NAME} sync
  ${BINARY_NAME} providers
  ${BINARY_NAME} resources
  ${BINARY_NAME} relationships
  ${BINARY_NAME} changes
  ${BINARY_NAME} history github:repository:1001
  ${BINARY_NAME} related github:repository:1001
  ${BINARY_NAME} context github:repository:1001
  ${BINARY_NAME} investigate vercel:project:prj_abc
  ${BINARY_NAME} investigate vercel:project:prj_abc --save
  ${BINARY_NAME} investigate vercel:project:prj_abc --task change-review --json
  ${BINARY_NAME} investigate vercel:project:prj_abc --task dependency-impact --json
  ${BINARY_NAME} investigate vercel:project:prj_abc --task response-recall --json
  ${BINARY_NAME} investigations
  ${BINARY_NAME} investigations --resource github:repository:1001
  ${BINARY_NAME} investigation inv:…
  ${BINARY_NAME} investigation inv:… --compare
  ${BINARY_NAME} resolution --investigation inv:… --decision "Rollback" --action "Reverted deploy" --outcome "Errors dropped"
  ${BINARY_NAME} resolution --resource vercel:project:prj_abc --decision "Rollback"
  ${BINARY_NAME} resolution --incident inc:… --decision "Keep holding" --action "Held deploys"
  ${BINARY_NAME} resolution --incident inc:… --resource github:repository:1001 --decision "Keep holding"
  ${BINARY_NAME} resolutions --investigation inv:…
  ${BINARY_NAME} resolutions --resource github:repository:1001
  ${BINARY_NAME} resolutions --evidence dpl_abc
  ${BINARY_NAME} resolution res:…
  ${BINARY_NAME} incident --resolution res:… --resolution res:… --title "API error spike"
  ${BINARY_NAME} incident inc:… --resolution res:…
  ${BINARY_NAME} incident inc:… --remove-resolution res:…
  ${BINARY_NAME} incident inc:… --title "Better name"
  ${BINARY_NAME} incident inc:… --clear-title
  ${BINARY_NAME} incident inc:… --recorded-at 2026-08-17T20:00:00.000Z
  ${BINARY_NAME} incident inc:… --occurred-at 2026-08-17T14:00:00.000Z
  ${BINARY_NAME} incident inc:… --clear-occurred-at
  ${BINARY_NAME} incidents
  ${BINARY_NAME} incidents --resolution res:…
  ${BINARY_NAME} incidents --resource github:repository:1001
  ${BINARY_NAME} incidents --investigation inv:…
  ${BINARY_NAME} incident inc:…
  ${BINARY_NAME} incident-link --incident inc:… --incident inc:… --reason "Same failure mode"
  ${BINARY_NAME} incident-link ilink:…
  ${BINARY_NAME} incident-links
  ${BINARY_NAME} incident-links --incident inc:…
  ${BINARY_NAME} precedents --incident inc:…
  ${BINARY_NAME} precedents --incident inc:… --json
  ${BINARY_NAME} recommendation --resource vercel:project:prj_abc --action-key rollback-deployment --proposal "Rollback the latest deployment"
  ${BINARY_NAME} recommendation --investigation inv:… --action-key inspect-database --proposal "Inspect the primary"
  ${BINARY_NAME} recommendation --incident inc:… --resource github:repository:1001 --action-key hold-deploys --proposal "Hold deploys"
  ${BINARY_NAME} recommendations --resource vercel:project:prj_abc
  ${BINARY_NAME} recommendation rec:…
  ${BINARY_NAME} decision --recommendation rec:… --disposition approved
  ${BINARY_NAME} decisions --recommendation rec:…
  ${BINARY_NAME} decision dec:…
  ${BINARY_NAME} action --decision dec:… --action-key rollback-deployment --summary "Rolled back dpl_abc"
  ${BINARY_NAME} actions --decision dec:…
  ${BINARY_NAME} action act:…
  ${BINARY_NAME} outcome --action act:… --assessment positive --summary "Error rate returned toward baseline"
  ${BINARY_NAME} outcome --action act:… --assessment positive --summary "Error rate dropped" --metric error-rate --before 12.4 --after 1.1 --unit percent
  ${BINARY_NAME} outcomes --action act:…
  ${BINARY_NAME} outcome out:…
  ${BINARY_NAME} mcp
  ${BINARY_NAME} agent status
  ${BINARY_NAME} agent setup
  ${BINARY_NAME} agent setup claude codex
  ${BINARY_NAME} agent remove claude
`;

const GLOBAL_DIR = `Global:
  --dir <path>                 Combie state directory (default: ./.combie)`;

const RESOURCE_REF = `Resource references:
  <resource-id>                Stable id: provider:kind:providerResourceId
                               Example: github:repository:1001`;

const READ_JSON = `Read options:
  --json                       Emit structured JSON for providers, resources,
                               related, investigate, context, investigations,
                               investigation <id>, or precedents`;

function normalizeTopic(topic: string): string {
  const t = topic.toLowerCase();
  const aliases: Record<string, string> = {
    investigations: "investigation",
    resolutions: "resolution",
    incidents: "incident",
    "incident-links": "incident-link",
    recommendations: "recommendation",
    decision: "recommendation",
    decisions: "recommendation",
    action: "recommendation",
    actions: "recommendation",
    outcome: "recommendation",
    outcomes: "recommendation",
  };
  return aliases[t] ?? t;
}

const COMMAND_PAGES: Record<string, string> = {
  help: `combie help — show command help

Usage:
  ${BINARY_NAME} help
  ${BINARY_NAME} help <command>
  ${BINARY_NAME} help --all

  ${BINARY_NAME} <command> --help

Bare ${BINARY_NAME}, ${BINARY_NAME} help, ${BINARY_NAME} --help, and ${BINARY_NAME} -h
print a short grouped index.

${BINARY_NAME} help <command> and ${BINARY_NAME} <command> --help print one command page.

${BINARY_NAME} help --all prints the full command catalog.

${GLOBAL_DIR}`,

  init: `combie init — initialize local Combie state

Usage:
  ${BINARY_NAME} init

Examples:
  ${BINARY_NAME} init

${GLOBAL_DIR}`,

  connect: `combie connect — connect a provider

Usage:
  ${BINARY_NAME} connect <provider>

Providers: cloudflare, github, vercel, sentry, neon, planetscale

Connect options:
  --token <token>              API token (avoid in shared shells; prefer --use-env / --use-gh)
  --token-id <id>              PlanetScale service-token ID (use with --token secret)
  --organization <slug>        PlanetScale organization when the token sees multiple orgs
  --use-env                    Use provider token from the environment
                               cloudflare: CLOUDFLARE_API_TOKEN
                               github: GITHUB_TOKEN or GH_TOKEN
                               vercel: VERCEL_TOKEN
                               sentry: SENTRY_AUTH_TOKEN or SENTRY_TOKEN
                               neon: NEON_API_KEY
                               planetscale: PLANETSCALE_SERVICE_TOKEN_ID + PLANETSCALE_SERVICE_TOKEN
  --use-gh                     GitHub only: reuse authenticated GitHub CLI (\`gh auth token\`)

Examples:
  ${BINARY_NAME} connect cloudflare --use-env
  ${BINARY_NAME} connect github --use-gh
  ${BINARY_NAME} connect vercel --use-env
  ${BINARY_NAME} connect sentry --use-env
  ${BINARY_NAME} connect neon --use-env
  ${BINARY_NAME} connect planetscale --use-env
  ${BINARY_NAME} connect planetscale --organization acme --use-env

${GLOBAL_DIR}`,

  sync: `combie sync — discover and store resources

Usage:
  ${BINARY_NAME} sync [provider]

Examples:
  ${BINARY_NAME} sync

${GLOBAL_DIR}`,

  providers: `combie providers — list configured providers

Usage:
  ${BINARY_NAME} providers

                               LAST SYNC is last successful sync; LAST ATTEMPT
                               is shown when a later try failed

${READ_JSON}

Examples:
  ${BINARY_NAME} providers

${GLOBAL_DIR}`,

  resources: `combie resources — list discovered resources

Usage:
  ${BINARY_NAME} resources

Resources options:
  --provider <id>              Filter by provider
  --kind <kind>                Filter by kind (worker, database, kv_namespace, zone, repository, project)

${READ_JSON}

Examples:
  ${BINARY_NAME} resources

${GLOBAL_DIR}`,

  relationships: `combie relationships — list known cross-provider relationships

Usage:
  ${BINARY_NAME} relationships

Examples:
  ${BINARY_NAME} relationships

${GLOBAL_DIR}`,

  changes: `combie changes — list observed Resource changes

Usage:
  ${BINARY_NAME} changes

Examples:
  ${BINARY_NAME} changes

${GLOBAL_DIR}`,

  history: `combie history — show current state and observed history

Usage:
  ${BINARY_NAME} history <resource-id>

${RESOURCE_REF}

Examples:
  ${BINARY_NAME} history github:repository:1001

${GLOBAL_DIR}`,

  related: `combie related — show one-hop related context for a resource

Usage:
  ${BINARY_NAME} related <resource-id>

${RESOURCE_REF}

${READ_JSON}

Examples:
  ${BINARY_NAME} related github:repository:1001

${GLOBAL_DIR}`,

  context: `combie context — compose current, related, and Change context

Usage:
  ${BINARY_NAME} context <resource-id>

${RESOURCE_REF}

${READ_JSON}

Examples:
  ${BINARY_NAME} context github:repository:1001

${GLOBAL_DIR}`,

  investigate: `combie investigate — compose one-hop investigation context around a resource

Usage:
  ${BINARY_NAME} investigate <resource-id>

${RESOURCE_REF}

Investigate options:
  --save                       Persist a retained investigation snapshot
  --task <profile>             With "investigate" + --json: select a task-scoped
                               view (change-review | dependency-impact | response-recall)

${READ_JSON}

Investigation history appears on investigate and investigation reopen
when snapshots exist.
Resolution memory appears on investigate and investigation reopen
when records exist, including the recorded text.
Incident memory appears on those same paths when groupings exist.

Examples:
  ${BINARY_NAME} investigate vercel:project:prj_abc
  ${BINARY_NAME} investigate vercel:project:prj_abc --save
  ${BINARY_NAME} investigate vercel:project:prj_abc --task change-review --json
  ${BINARY_NAME} investigate vercel:project:prj_abc --task dependency-impact --json
  ${BINARY_NAME} investigate vercel:project:prj_abc --task response-recall --json

${GLOBAL_DIR}`,

  investigation: `combie investigation / investigations — saved investigation snapshots

Usage:
  ${BINARY_NAME} investigations
  ${BINARY_NAME} investigations --resource <resource-id>
  ${BINARY_NAME} investigation <id>
  ${BINARY_NAME} investigation <id> --compare

Investigate options:
  --compare                    With "investigation <id>": compare snapshot to current compose
  --resource <resource-id>     With "investigations": list snapshots for one subject

${READ_JSON}

Investigation history appears on investigate and investigation reopen
when snapshots exist.

Examples:
  ${BINARY_NAME} investigations
  ${BINARY_NAME} investigations --resource github:repository:1001
  ${BINARY_NAME} investigation inv:…
  ${BINARY_NAME} investigation inv:… --compare

${GLOBAL_DIR}`,

  resolution: `combie resolution / resolutions — explicit investigation resolution memory

Usage:
  ${BINARY_NAME} resolution <resolution-id>
  ${BINARY_NAME} resolution --investigation <id> (--decision|--action|--outcome) [...]
  ${BINARY_NAME} resolution --resource <resource-id> (--decision|--action|--outcome) [...]
  ${BINARY_NAME} resolution --incident <incident-id> (--decision|--action|--outcome) [...]
  ${BINARY_NAME} resolution --incident <incident-id> --resource <resource-id> (--decision|--action|--outcome) [...]
  ${BINARY_NAME} resolutions [--investigation|--resource|--evidence]

Recording requires at least one of --decision, --action, or --outcome.

Options:
  --investigation <id>         With "resolution": investigation to record against
                               With "resolutions": list resolutions for one investigation
  --resource <resource-id>     With "resolution": resource to record against (no saved investigation), or with --incident the subject of the new row (must already be a member subject)
                               With "resolutions": list resolutions for one subject
  --incident <incident-id>     With "resolution": existing incident grouping to record
                               against (subject copied from members, or named with --resource; one exact id)
  --decision <text>            Explicit decision (what you decided)
  --action <text>              Explicit action (what you actually did)
  --outcome <text>             Explicit outcome (what happened afterward)
  --evidence <id>              Attach an exact local evidence id (optional, repeatable; never inferred)
                               With "resolutions": list retained resolutions that attached that exact local id (membership only; one exact id)

Resolution memory appears on investigate and investigation reopen
when records exist, including the recorded text.

Examples:
  ${BINARY_NAME} resolution --investigation inv:… --decision "Rollback" --action "Reverted deploy" --outcome "Errors dropped"
  ${BINARY_NAME} resolution --resource vercel:project:prj_abc --decision "Rollback"
  ${BINARY_NAME} resolution --incident inc:… --decision "Keep holding" --action "Held deploys"
  ${BINARY_NAME} resolution --incident inc:… --resource github:repository:1001 --decision "Keep holding"
  ${BINARY_NAME} resolutions --investigation inv:…
  ${BINARY_NAME} resolutions --resource github:repository:1001
  ${BINARY_NAME} resolutions --evidence dpl_abc
  ${BINARY_NAME} resolution res:…

${GLOBAL_DIR}`,

  incident: `combie incident / incidents — explicit incident grouping of resolutions

Usage:
  ${BINARY_NAME} incident --resolution <resolution-id> [--resolution ...] [--title <text>]
  ${BINARY_NAME} incident <id>
  ${BINARY_NAME} incident <id> --resolution <resolution-id>
  ${BINARY_NAME} incident <id> --remove-resolution <resolution-id>
  ${BINARY_NAME} incident <id> --title <text>
  ${BINARY_NAME} incident <id> --clear-title
  ${BINARY_NAME} incident <id> --recorded-at <iso>
  ${BINARY_NAME} incident <id> --occurred-at <iso>
  ${BINARY_NAME} incident <id> --clear-occurred-at
  ${BINARY_NAME} incidents [--resolution|--resource|--investigation]

Options:
  --resolution <resolution-id> With "incident": exact Resolution id to group at create (repeatable), or to append to incident <id>
                               With "incidents": list groupings that named that exact resolution id (membership only; one exact id)
  --remove-resolution <resolution-id> With "incident <id>": exact current member Resolution id to detach (repeatable; remaining members must stay ≥2)
  --title <text>               Optional name for an incident grouping at create, or to retitle incident <id>
  --clear-title                With "incident <id>": omit the stored title (members and recordedAt unchanged)
  --recorded-at <iso>          With "incident <id>": replace recordedAt (title and members unchanged)
  --occurred-at <iso>          With "incident <id>": set occurredAt (recordedAt, title, and members unchanged)
  --clear-occurred-at           With "incident <id>": omit the stored occurredAt (recordedAt, title, and members unchanged)
  --resource <resource-id>     With "incidents": list groupings with a member Resolution on one subject
  --investigation <id>         With "incidents": list groupings with a member Resolution recorded against that investigation (membership only; one exact id)

Incident memory appears on those same paths when groupings exist.

Examples:
  ${BINARY_NAME} incident --resolution res:… --resolution res:… --title "API error spike"
  ${BINARY_NAME} incident inc:… --resolution res:…
  ${BINARY_NAME} incident inc:… --remove-resolution res:…
  ${BINARY_NAME} incident inc:… --title "Better name"
  ${BINARY_NAME} incident inc:… --clear-title
  ${BINARY_NAME} incident inc:… --recorded-at 2026-08-17T20:00:00.000Z
  ${BINARY_NAME} incident inc:… --occurred-at 2026-08-17T14:00:00.000Z
  ${BINARY_NAME} incident inc:… --clear-occurred-at
  ${BINARY_NAME} incidents
  ${BINARY_NAME} incidents --resolution res:…
  ${BINARY_NAME} incidents --resource github:repository:1001
  ${BINARY_NAME} incidents --investigation inv:…
  ${BINARY_NAME} incident inc:…

${GLOBAL_DIR}`,

  "incident-link": `combie incident-link / incident-links — organizational links between incidents

Usage:
  ${BINARY_NAME} incident-link --incident <incident-id> --incident <incident-id> --reason <text>
  ${BINARY_NAME} incident-link <id>
  ${BINARY_NAME} incident-links [--incident <incident-id>]

Options:
  --incident <incident-id>     With "incident-link": exact Incident id to link (repeatable; exactly two distinct)
                               With "incident-links": list links that name that exact Incident id
  --reason <text>              With "incident-link": required organizational claim for the link

Examples:
  ${BINARY_NAME} incident-link --incident inc:… --incident inc:… --reason "Same failure mode"
  ${BINARY_NAME} incident-link ilink:…
  ${BINARY_NAME} incident-links
  ${BINARY_NAME} incident-links --incident inc:…

${GLOBAL_DIR}`,

  precedents: `combie precedents — explicit and candidate precedents for one incident

Usage:
  ${BINARY_NAME} precedents --incident <incident-id> [--json]

Options:
  --incident <incident-id>     With "precedents": exact query Incident id (one required)

${READ_JSON}

Examples:
  ${BINARY_NAME} precedents --incident inc:…
  ${BINARY_NAME} precedents --incident inc:… --json

${GLOBAL_DIR}`,

  recommendation: `combie structured response memory — recommendation, decision, action, outcome

Usage:
  ${BINARY_NAME} recommendation [--investigation|--resource|--incident] ...
  ${BINARY_NAME} recommendation <id>
  ${BINARY_NAME} recommendations [--investigation|--resource|--incident]
  ${BINARY_NAME} decision --recommendation <id> ...
  ${BINARY_NAME} decision <id>
  ${BINARY_NAME} decisions --recommendation <id>
  ${BINARY_NAME} action --decision <id> ...
  ${BINARY_NAME} action <id>
  ${BINARY_NAME} actions --decision <id>
  ${BINARY_NAME} outcome --action <id> ...
  ${BINARY_NAME} outcome <id>
  ${BINARY_NAME} outcomes --action <id>

Options:
  --resource <resource-id>     With "recommendation": resource to record against, or with --incident the named member subject
                               With "recommendations": list recommendations for one subject
  --investigation <id>         With "recommendation": investigation to record against
                               With "recommendations": list recommendations for one investigation
  --incident <incident-id>     With "recommendation": existing incident grouping to record against (requires --resource)
                               With "recommendations": list recommendations for one incident
  --recommendation <id>        With "decision": parent recommendation to record against
                               With "decisions": list decisions for one recommendation
  --decision <text>            With "action": parent decision to record against
                               With "actions": list actions for one decision
  --action <text>              With "outcome": parent action to record against
                               With "outcomes": list outcomes for one action
  --evidence <id>              With "recommendation" / "outcome": attach exact local evidence ids at record time (repeatable)
  --action-key <token>         Lower-kebab response category (recommendation / action)
  --proposal <text>            Explicit proposed response
  --rationale <text>           Optional recommendation rationale
  --disposition <value>        approved, rejected, deferred, or modified
  --note <text>                Optional decision note (required when disposition is modified)
  --summary <text>             Explicit action or outcome summary
  --performed-at <iso>         With "action": named attempt time (omit means unknown)
  --assessment <value>         positive, negative, mixed, neutral, or inconclusive
  --observed-at <iso>          With "outcome": named observation time (omit means unknown)
  --metric <name>              With "outcome": measurement metric (atomic with --before/--after/--unit)
  --before <number>            With "outcome": measurement before (finite number; atomic)
  --after <number>             With "outcome": measurement after (finite number; atomic)
  --unit <unit>                With "outcome": measurement unit (atomic)

Examples:
  ${BINARY_NAME} recommendation --resource vercel:project:prj_abc --action-key rollback-deployment --proposal "Rollback the latest deployment"
  ${BINARY_NAME} recommendation --investigation inv:… --action-key inspect-database --proposal "Inspect the primary"
  ${BINARY_NAME} recommendation --incident inc:… --resource github:repository:1001 --action-key hold-deploys --proposal "Hold deploys"
  ${BINARY_NAME} recommendations --resource vercel:project:prj_abc
  ${BINARY_NAME} recommendation rec:…
  ${BINARY_NAME} decision --recommendation rec:… --disposition approved
  ${BINARY_NAME} decisions --recommendation rec:…
  ${BINARY_NAME} decision dec:…
  ${BINARY_NAME} action --decision dec:… --action-key rollback-deployment --summary "Rolled back dpl_abc"
  ${BINARY_NAME} actions --decision dec:…
  ${BINARY_NAME} action act:…
  ${BINARY_NAME} outcome --action act:… --assessment positive --summary "Error rate returned toward baseline"
  ${BINARY_NAME} outcome --action act:… --assessment positive --summary "Error rate dropped" --metric error-rate --before 12.4 --after 1.1 --unit percent
  ${BINARY_NAME} outcomes --action act:…
  ${BINARY_NAME} outcome out:…

${GLOBAL_DIR}`,

  version: `combie version — show build version

Usage:
  ${BINARY_NAME} version
  ${BINARY_NAME} --version

${GLOBAL_DIR}`,

  mcp: `combie mcp — start read-only MCP server over stdio

Usage:
  ${BINARY_NAME} mcp

Examples:
  ${BINARY_NAME} mcp

${GLOBAL_DIR}`,

  agent: `combie agent — MCP setup for Claude, Codex, Cursor

Usage:
  ${BINARY_NAME} agent status
  ${BINARY_NAME} agent setup [agent...]
  ${BINARY_NAME} agent remove <agent...>

Agents: claude, codex, cursor

Global:
  --dir <path>                 Combie state directory (default: ./.combie)
  --yes                        Skip confirmation prompts (non-interactive)

Examples:
  ${BINARY_NAME} agent status
  ${BINARY_NAME} agent setup
  ${BINARY_NAME} agent setup claude codex
  ${BINARY_NAME} agent remove claude`,
};

export function shortHelp(): string {
  return `combie — engineering context layer

Setup
  init                 Initialize local Combie state
  connect <provider>   Connect a provider
  sync [provider]      Discover and store resources

See
  providers            List connected providers
  resources            List discovered resources
  investigate <id>     Compose investigation context around a resource

Remember
  investigations       List saved investigation snapshots
  investigation <id>   Reopen a saved snapshot
  resolutions          List retained resolutions
  resolution [id]      Record or show a resolution
  incidents            List incident groupings
  incident [id]        Record, show, or update an incident grouping

Agents
  agent                MCP setup for Claude, Codex, Cursor
  mcp                  Start the read-only MCP server

Also: relationships, changes, history, related, context,
      incident-link, precedents, recommendation, decision, action, outcome

More:  ${BINARY_NAME} help <command>
       ${BINARY_NAME} help --all

Global:
  --dir <path>         Combie state directory (default: ./.combie)
  --help, -h           Show help
  --version            Show build version
  --json               On providers, resources, related, context, investigate, investigations, investigation, precedents
`;
}

export function fullHelp(): string {
  return FULL_HELP_TEMPLATE;
}

export const HELP = FULL_HELP_TEMPLATE;

export function commandHelp(topic: string): string | null {
  const key = normalizeTopic(topic);
  return COMMAND_PAGES[key] ?? null;
}

export function unknownCommandMessage(command: string): string {
  return `Unknown command: ${command}\nSee: ${BINARY_NAME} help`;
}

export function unknownHelpTopicMessage(topic: string): string {
  return `Unknown help topic: ${topic}\nSee: ${BINARY_NAME} help`;
}

export function helpConflictMessage(): string {
  return `Use ${BINARY_NAME} help --all or ${BINARY_NAME} help <command>, not both.`;
}
