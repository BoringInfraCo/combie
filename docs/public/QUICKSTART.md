# Combie Quickstart

Combie is an open engineering context layer: a local-first CLI that inventories
resources across Cloudflare, GitHub, Vercel, Sentry, Neon, and PlanetScale,
remembers changes, persists selected provider-native evidence (Vercel
deployments, GitHub workflow runs, Neon operations), and supports offline
one-hop investigation. You drive every step — no daemon, no background
refresh, no webhooks. Allow ~20 minutes.

## 1. Requirements

- **macOS or Linux** — Combie also runs on Windows via WSL; native Windows support is planned
- **Tokens**: GitHub is the validated first-cohort provider. The other
  supported providers are optional and outside the GitHub-first beta promise.
- No additional runtime required — the installed binary includes everything it needs

| Provider    | What you need                                          |
| ----------- | ------------------------------------------------------ |
| GitHub      | Personal access token with `repo` read access          |
| Vercel      | Access token (Dashboard -> Settings -> Tokens)         |
| Cloudflare  | API token with Account read: Workers, D1, KV, Zones    |
| Sentry      | Auth token with organization read access               |
| Neon        | API key                                                |
| PlanetScale | Service-token ID + secret pair (read access)           |

Never set the same variable two ways — use **one** method per provider.
## 2. Install

```bash
curl -fsSL https://combie.dev/install | sh
```

Verify:

```bash
combie --version
```

Expected output:

```bash
combie 0.6.2
```

The installer places Combie at `~/.local/bin/combie`. If you see `combie: command not found`, add it to your PATH:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

To make this permanent, add that line to `~/.bashrc`, `~/.zshrc`, or `~/.profile`.

**Build from source (alternative):** Clone the repository and run with Bun:

```bash
git clone https://github.com/BoringInfraCo/combie
cd combie
bun install --frozen-lockfile
bun run combie help
```

If you see `Could not find package`, check that you are in the repository root after a complete clone.

## 3. Initialize

```bash
combie init
```
Expected output: `Initialized Combie at /path/to/cwd/.combie`.

This creates the state directory `.combie` (mode 0700) in the working
directory containing `combie.db` (SQLite: resources, changes, relationships,
evidence). The separate `credentials` file is created on first successful
connect with mode 0600. The global flag
`--dir <path>` points any command at a different state directory (handy for
`/tmp` experiments); `COMBIE_HOME` does the same. No encryption at rest, no OS
keychain. Deleting `.combie` removes everything, including stored credentials —
that is the full reset. `init` is idempotent.

**Troubleshooting:** `.combie` in the wrong place -> it is created in the
current working directory; `rm -rf .combie` and re-run elsewhere.

## 4. Connect GitHub
Choose **one** method.

```bash
export GITHUB_TOKEN=<token>
combie connect github --use-env
```

`GH_TOKEN` works too. Alternatives: `gh auth login` then `combie
connect github --use-gh` (reuse the authenticated GitHub CLI), or `bun run
combie connect github --token <token>`.

Expected output:

```
Connected GitHub (account: <your-account>).
Credential stored in the local restricted-permission credentials file.
```

**Troubleshooting:** `GITHUB_TOKEN (or GH_TOKEN) is not set` -> env var not
exported in this shell. `GitHub CLI returned an empty token` -> run
`gh auth login` first. `authentication failed` -> wrong token or missing
`repo` read scope.

## 5. (Optional) Connect Vercel
```bash
export VERCEL_TOKEN=<token>
combie connect vercel --use-env
```

Expected output:

```
Connected Vercel (account: <your-account>).
Credential stored in the local restricted-permission credentials file.
```

**Troubleshooting:** same `is not set` / `authentication failed` checks as
GitHub above. This beta does not pass a Vercel `teamId`; team-owned projects
may therefore be absent. Vercel is outside the validated GitHub-first cohort;
use a personal-scope project only when intentionally testing this known gap.

## 6. (Optional) Connect Cloudflare
```bash
export CLOUDFLARE_API_TOKEN=<token>
combie connect cloudflare --use-env
```

The token must be able to list the account and read Workers scripts, D1
databases, KV namespaces, and zones. Discovery is all-or-nothing: if any of
those calls is denied, Cloudflare sync fails with a permission error; it does
not silently return an empty inventory. Tokens that can see multiple accounts
are outside the validated cohort because this beta selects the first returned
account.

## 7. (Optional) Connect Sentry
```bash
export SENTRY_AUTH_TOKEN=<token>
combie connect sentry --use-env
```

`SENTRY_TOKEN` works as an alternative name.
The token must be able to list organizations and their projects (`org:read` on
legacy token scopes).

## 8. (Optional) Connect Neon and PlanetScale
```bash
export NEON_API_KEY=<key>
combie connect neon --use-env
```

PlanetScale (ID and secret are both required):

```bash
export PLANETSCALE_SERVICE_TOKEN_ID=<id>
export PLANETSCALE_SERVICE_TOKEN=<secret>
combie connect planetscale --use-env
```

If the token can access multiple organizations, add the organization:

```bash
combie connect planetscale --organization <slug> --use-env
```

Alternative to env vars (ID + secret as flags): `combie connect
planetscale --token-id <id> --token <secret>`.

**A note on `--token` flags:** passing tokens directly as CLI flags can persist
them in your shell history. Prefer the env-var flow everywhere.

## 9. Sync
```bash
combie sync
```

`sync` queries every connected provider and updates the local SQLite state:
resources, changes, relationships, and provider-native evidence. `connect`
only stores the credential — nothing is discovered until you sync.

Expected output: a per-provider summary. If one provider fails (bad token,
network, rate limit), the others still sync; errors are reported per provider
and the command exits non-zero if any provider failed.

Sync a single provider: `combie sync github`.

**Troubleshooting:** `not initialized` -> run `init` first. `authentication
failed` for a provider -> reconnect it (steps 4–8). `no supported resources
found` -> the account has none of the discoverable kinds (`worker`,
`database`, `kv_namespace`, `zone`, `repository`, `project`). Valid outcome.

## 10. Inspect what you have
```bash
combie providers
combie resources
combie relationships
```

- `providers` — which providers are connected and when they last synced.
- `resources` — every discovered resource. Filter with `--provider <id>` or
  `--kind <kind>` (kinds listed above).
- `relationships` — cross-provider edges. Combie proves exactly three kinds,
  only when deterministic evidence exists:
  - `source_for`: GitHub repository -> Vercel project (the project's Git link
    must match a discovered repository)
  - `uses_domain_in`: Vercel project -> Cloudflare zone (a custom domain apex
    must match a discovered zone)
  - `code_mapped_to`: GitHub repository -> Sentry project (Sentry configured
    the repository as source context; it does not prove error-reporting
    completeness or causality)

If `relationships` is empty, no deterministic evidence was found — partial
data produces no edges by design.

## 11. Choose a resource ID
```bash
combie resources
```

Resource IDs have an exact format, `provider:kind:providerResourceId`:

```
github:repository:915052094
vercel:project:prj_abc123
cloudflare:zone:zone_example_com
```

Copy the exact ID from the `resources` output. There is no fuzzy lookup — the
ID must match exactly. A good first target is a Vercel project (or GitHub
repository) you recognize.

## 12. Investigate
```bash
combie investigate vercel:project:prj_abc123
```

The report is composed deterministically, offline, read-only, one hop. It
contains: current state; known facts and missing context; subject changes over
time; provider-native evidence (e.g. Vercel deployments, GitHub workflow
runs); related resources within one hop; shared commit context when exact Git
commit evidence exists across GitHub and Vercel (full-SHA matches only); a
provider-activity chronology; and detailed evidence.

It does **not** contain root-cause analysis or AI reasoning — those do not
exist yet. You get the facts and the evidence trail; interpretation is yours.

For a smaller task-scoped view, name one of three profiles with `--json`:

```bash
combie investigate vercel:project:prj_abc123 --task change-review --json
combie investigate vercel:project:prj_abc123 --task dependency-impact --json
combie investigate vercel:project:prj_abc123 --task response-recall --json
```

`change-review` returns what changed and the evidence chronology;
`dependency-impact` returns proven connectivity and paths (connectivity, not
blast radius); `response-recall` returns retained investigations, resolutions,
incident groupings, additive `structuredResponseMemory` (exact
Recommendation→Decision→Action→Outcome chains for that subject), and additive
`incidentPrecedentMemory` (one inspectable precedent set per exact Incident in
`incidentMemory`; temporally prior peers only —
`effectiveAt = occurredAt ?? recordedAt`; `[]` when empty). Each is read-only
and deterministic; omit `--task` for the full investigation document.

Every `--task` result also carries a top-level `availableOnDemand` array —
inert descriptors for deeper context on demand. Follow one only when the task
result is insufficient:

```json
{
  "availableOnDemand": [
    { "kind": "current-investigation",
      "cli": { "argv": ["combie", "investigate", "<resource-id>", "--json"] },
      "mcp": { "tool": "investigate_resource", "arguments": { "resourceId": "<resource-id>" } } }
  ]
}
```

The `current-investigation` target re-composes live now; `retained-investigation`
targets (only on `response-recall`) are frozen at `composedAt`. `cli.argv` and
`mcp` are inert descriptors — Combie does not execute them.

### Optional structured response memory (CLI-only)

Four append-only records — Recommendation (`rec:`) → Decision (`dec:`) →
Action (`act:`) → Outcome (`out:`) — capture an explicit organizational
response chain. Direct create/show/list is CLI-only (human text; no `--json`
on these commands). Recall is `investigate --task response-recall --json` or
MCP `investigate_resource` with `task: "response-recall"`
(`structuredResponseMemory`; `[]` when empty). MCP cannot write. Action is
not inferred from provider activity. This is not a replacement for Resolution.

```bash
combie recommendation --resource vercel:project:prj_abc123 --action-key rollback --proposal "Roll back the last production deploy"
combie decision --recommendation rec:01h... --disposition approved
combie action --decision dec:01h... --action-key rollback --summary "Rolled back production"
combie outcome --action act:01h... --assessment positive --summary "Error rate returned to baseline"
```

### Optional incident links and precedents (CLI-only)

Link two exact Incidents with an authored reason (human claim, not provider
proof). Retrieve precedents separately — explicit prior links vs exact-match
candidates (not recommendations). A peer is a precedent only when temporally
prior: `effectiveAt = occurredAt ?? recordedAt`, and
`peer.effectiveAt < query.effectiveAt`. Equal or later Incidents are never
precedents (non-prior links remain on `incident-links`):

```bash
combie incident-link --incident inc:… --incident inc:… --reason "Same failure mode"
combie incident-links [--incident inc:…]
combie precedents --incident inc:…
combie precedents --incident inc:… --json
```

`precedents --json` is the only new JSON allowlist entry; link commands stay
human text. `response-recall` also surfaces `incidentPrecedentMemory`.

**Troubleshooting:** `Unknown resource` -> the ID is not in the store;
re-check the exact string from `resources`, or re-run `sync` — state is only
as fresh as your last sync. Shared commit context missing -> that section only
appears when a GitHub commit SHA exactly matches Vercel deployment commit
evidence; partial or fuzzy matches never count.

## 13. Re-sync later
Sync is operator-driven. For fresh state, run it again: `combie sync`.

Read commands (`resources`, `relationships`, `changes`, `history`, `related`,
`context`, `investigate`) never touch the network. Only `connect` and `sync`
do.

## 14. Verify offline behavior
```bash
unset GITHUB_TOKEN GH_TOKEN VERCEL_TOKEN CLOUDFLARE_API_TOKEN SENTRY_AUTH_TOKEN SENTRY_TOKEN NEON_API_KEY PLANETSCALE_SERVICE_TOKEN_ID PLANETSCALE_SERVICE_TOKEN
combie resources
combie investigate <resource-id>
```

Both still work: they read only `.combie`. Nothing in the read path needs
credentials or the network.

To give a local agent the same read-only context, follow
[MCP.md](MCP.md). The MCP server exposes exactly five read-only stdio tools and
still requires a prior manual sync. MCP.md also documents an optional
installable composition skill for agents.

Reset everything (including stored credentials):

```bash
rm -rf .combie
combie init
```

## 15. Troubleshooting basics
| Symptom                        | Cause and fix                                                  |
| ------------------------------ | -------------------------------------------------------------- |
| `not initialized`              | Run `combie init`.                                     |
| `unknown provider`             | Check spelling: `cloudflare`, `github`, `vercel`, `sentry`, `neon`, `planetscale`. |
| `X_TOKEN is not set`           | Wrong env var name, or not exported in this shell.             |
| `authentication failed`        | Token rejected. Verify value and scopes.                       |
| `no relationships`             | Expected without exact evidence: a Vercel Git link must match a discovered GitHub repo, and a domain apex must match a discovered Cloudflare zone. |
| Shared commit context missing  | Only exact full-SHA matches across GitHub and Vercel produce it. |
| `no supported resources found` | The account has none of the discoverable kinds. Valid result.  |

---

Still stuck? Most common causes: not in the repo root (so `./.combie` lives
somewhere unexpected), an env var exported in a different shell than the one
running `connect`, and missing read scopes on a token. Re-reading steps 3, 4,
and 9 covers the rest.
