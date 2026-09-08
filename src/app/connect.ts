import { spawnSync } from "node:child_process";
import { Store } from "../storage/store.ts";
import { CredentialsStore } from "../storage/credentials.ts";
import { getProvider } from "../provider/registry.ts";
import { encodePlanetScaleCredential } from "../providers/planetscale/credentials.ts";
import { BINARY_NAME } from "../cli/constants.ts";
import {
  notInitialized,
  unknownProvider,
  CombieError,
} from "./errors.ts";

export interface ConnectOptions {
  baseDir: string;
  providerId: string;
  /** Explicit token from user (prompt or flag). */
  token?: string;
  /**
   * PlanetScale only: service-token ID paired with `token` (the secret).
   * Prefer --use-env with PLANETSCALE_SERVICE_TOKEN_ID + PLANETSCALE_SERVICE_TOKEN.
   */
  tokenId?: string;
  /**
   * When true, use a provider-specific environment variable after user consent.
   * Cloudflare: CLOUDFLARE_API_TOKEN
   * GitHub: GITHUB_TOKEN or GH_TOKEN
   * Vercel: VERCEL_TOKEN
   * Sentry: SENTRY_AUTH_TOKEN or SENTRY_TOKEN
   * Neon: NEON_API_KEY
   * PlanetScale: PLANETSCALE_SERVICE_TOKEN_ID + PLANETSCALE_SERVICE_TOKEN
   */
  useEnvToken?: boolean;
  /**
   * When true (GitHub only), use `gh auth token` after explicit user authorization.
   * Does not parse private credential files.
   */
  useGh?: boolean;
  /**
   * PlanetScale (and similar multi-org providers): explicit organization slug
   * when the credential can access more than one organization.
   */
  organization?: string;
  env?: NodeJS.ProcessEnv;
  /** Injected for tests: resolve a token from `gh auth token`. */
  ghTokenResolver?: () => string;
}

export interface ConnectResult {
  provider: string;
  accountId?: string;
  accountName?: string;
  message: string;
}

function resolveCloudflareToken(options: ConnectOptions): string {
  if (options.token && options.token.trim().length > 0) {
    return options.token.trim();
  }
  if (options.useEnvToken) {
    const env = options.env ?? process.env;
    const fromEnv = env.CLOUDFLARE_API_TOKEN?.trim();
    if (fromEnv) return fromEnv;
    throw new CombieError(
      "MISSING_TOKEN",
      "CLOUDFLARE_API_TOKEN is not set.\nExport a token with account read permissions, or pass --token.",
    );
  }
  throw new CombieError(
    "MISSING_TOKEN",
    "No Cloudflare API token provided.\n" +
      "Options:\n" +
      "  1. Export CLOUDFLARE_API_TOKEN and run: " + BINARY_NAME + " connect cloudflare --use-env\n" +
      "  2. Run: " + BINARY_NAME + " connect cloudflare --token <token>",
  );
}

/**
 * Resolve a GitHub token via explicit authorization only:
 * --token, --use-env (GITHUB_TOKEN / GH_TOKEN), or --use-gh (`gh auth token`).
 */
function resolveGitHubToken(options: ConnectOptions): string {
  if (options.token && options.token.trim().length > 0) {
    return options.token.trim();
  }

  if (options.useGh) {
    if (options.ghTokenResolver) {
      const token = options.ghTokenResolver().trim();
      if (!token) {
        throw new CombieError(
          "GH_AUTH_FAILED",
          "GitHub connection failed: GitHub CLI returned an empty token.\nRun `gh auth login` and retry.",
        );
      }
      return token;
    }
    return resolveTokenFromGhCli();
  }

  if (options.useEnvToken) {
    const env = options.env ?? process.env;
    const fromEnv =
      env.GITHUB_TOKEN?.trim() ||
      env.GH_TOKEN?.trim() ||
      undefined;
    if (fromEnv) return fromEnv;
    throw new CombieError(
      "MISSING_TOKEN",
      "GITHUB_TOKEN (or GH_TOKEN) is not set.\n" +
        "Export a token with repo read access, or use --token / --use-gh.",
    );
  }

  throw new CombieError(
    "MISSING_TOKEN",
    "No GitHub token provided.\n" +
      "Options:\n" +
      "  1. Run: " + BINARY_NAME + " connect github --use-gh   (reuse authenticated GitHub CLI)\n" +
      "  2. Export GITHUB_TOKEN and run: " + BINARY_NAME + " connect github --use-env\n" +
      "  3. Run: " + BINARY_NAME + " connect github --token <token>",
  );
}

function resolveVercelToken(options: ConnectOptions): string {
  if (options.token && options.token.trim().length > 0) {
    return options.token.trim();
  }
  if (options.useEnvToken) {
    const env = options.env ?? process.env;
    const fromEnv = env.VERCEL_TOKEN?.trim();
    if (fromEnv) return fromEnv;
    throw new CombieError(
      "MISSING_TOKEN",
      "VERCEL_TOKEN is not set.\nExport a token and run: " + BINARY_NAME + " connect vercel --use-env",
    );
  }
  throw new CombieError(
    "MISSING_TOKEN",
    "No Vercel token provided.\n" +
      "Options:\n" +
      "  1. Export VERCEL_TOKEN and run: " + BINARY_NAME + " connect vercel --use-env\n" +
      "  2. Run: " + BINARY_NAME + " connect vercel --token <token>",
  );
}

function resolveSentryToken(options: ConnectOptions): string {
  if (options.token && options.token.trim().length > 0) {
    return options.token.trim();
  }
  if (options.useEnvToken) {
    const env = options.env ?? process.env;
    const fromEnv =
      env.SENTRY_AUTH_TOKEN?.trim() ||
      env.SENTRY_TOKEN?.trim() ||
      undefined;
    if (fromEnv) return fromEnv;
    throw new CombieError(
      "MISSING_TOKEN",
      "SENTRY_AUTH_TOKEN (or SENTRY_TOKEN) is not set.\nExport a token and run: " + BINARY_NAME + " connect sentry --use-env",
    );
  }
  throw new CombieError(
    "MISSING_TOKEN",
    "No Sentry token provided.\n" +
      "Options:\n" +
      "  1. Export SENTRY_AUTH_TOKEN (or SENTRY_TOKEN) and run: " + BINARY_NAME + " connect sentry --use-env\n" +
      "  2. Run: " + BINARY_NAME + " connect sentry --token <token>",
  );
}

function resolveNeonToken(options: ConnectOptions): string {
  if (options.token && options.token.trim().length > 0) {
    return options.token.trim();
  }
  if (options.useEnvToken) {
    const env = options.env ?? process.env;
    const fromEnv = env.NEON_API_KEY?.trim();
    if (fromEnv) return fromEnv;
    throw new CombieError(
      "MISSING_TOKEN",
      "NEON_API_KEY is not set.\nExport an API key and run: " + BINARY_NAME + " connect neon --use-env",
    );
  }
  throw new CombieError(
    "MISSING_TOKEN",
    "No Neon API key provided.\n" +
      "Options:\n" +
      "  1. Export NEON_API_KEY and run: " + BINARY_NAME + " connect neon --use-env\n" +
      "  2. Run: " + BINARY_NAME + " connect neon --token <api-key>",
  );
}

/**
 * PlanetScale requires a service-token ID + secret pair. Stored as one opaque
 * composite string (`id:secret`) so CredentialsStore stays single-token.
 */
function resolvePlanetScaleToken(options: ConnectOptions): string {
  const explicitId = options.tokenId?.trim();
  const explicitSecret = options.token?.trim();
  if (explicitId || explicitSecret) {
    if (!explicitId || !explicitSecret) {
      throw new CombieError(
        "MISSING_TOKEN",
        "PlanetScale requires both the service-token ID and secret.\n" +
          "Pass --token-id <id> together with --token <secret>, or use --use-env.",
      );
    }
    return encodePlanetScaleCredential(explicitId, explicitSecret);
  }

  if (options.useEnvToken) {
    const env = options.env ?? process.env;
    const id = env.PLANETSCALE_SERVICE_TOKEN_ID?.trim();
    const secret = env.PLANETSCALE_SERVICE_TOKEN?.trim();
    if (id && secret) {
      return encodePlanetScaleCredential(id, secret);
    }
    const missing: string[] = [];
    if (!id) missing.push("PLANETSCALE_SERVICE_TOKEN_ID");
    if (!secret) missing.push("PLANETSCALE_SERVICE_TOKEN");
    throw new CombieError(
      "MISSING_TOKEN",
      `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not set.\n` +
        "Export both service-token values and run: " + BINARY_NAME + " connect planetscale --use-env",
    );
  }

  throw new CombieError(
    "MISSING_TOKEN",
    "No PlanetScale service token provided.\n" +
      "Options:\n" +
      "  1. Export PLANETSCALE_SERVICE_TOKEN_ID and PLANETSCALE_SERVICE_TOKEN\n" +
      "     then run: " + BINARY_NAME + " connect planetscale --use-env\n" +
      "  2. Run: " + BINARY_NAME + " connect planetscale --token-id <id> --token <secret>\n" +
      "When the token can access multiple organizations, add --organization <slug>.",
  );
}

function resolveTokenFromGhCli(): string {
  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync("gh", ["auth", "token"], {
      encoding: "utf8",
      timeout: 15_000,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    throw new CombieError(
      "GH_UNAVAILABLE",
      `GitHub connection failed: could not run GitHub CLI (${reason}).\nInstall gh from https://cli.github.com/ or pass --token / --use-env.`,
    );
  }

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new CombieError(
        "GH_UNAVAILABLE",
        "GitHub connection failed: GitHub CLI (`gh`) is not installed.\nInstall it from https://cli.github.com/ or pass --token / --use-env.",
      );
    }
    throw new CombieError(
      "GH_UNAVAILABLE",
      `GitHub connection failed: could not run GitHub CLI (${result.error.message}).\nInstall gh or pass --token / --use-env.`,
    );
  }

  if (result.status !== 0) {
    const stderr = String(result.stderr ?? "").trim();
    const hint =
      stderr.toLowerCase().includes("not logged") ||
      stderr.toLowerCase().includes("auth login")
        ? "GitHub CLI is not authenticated. Run `gh auth login` and retry."
        : "GitHub CLI could not produce a token. Run `gh auth login` and retry.";
    throw new CombieError("GH_AUTH_FAILED", `GitHub connection failed: ${hint}`);
  }

  const token = String(result.stdout ?? "").trim();
  if (!token) {
    throw new CombieError(
      "GH_AUTH_FAILED",
      "GitHub connection failed: GitHub CLI returned an empty token.\nRun `gh auth login` and retry.",
    );
  }
  return token;
}

function resolveToken(providerId: string, options: ConnectOptions): string {
  switch (providerId) {
    case "cloudflare":
      return resolveCloudflareToken(options);
    case "github":
      return resolveGitHubToken(options);
    case "vercel":
      return resolveVercelToken(options);
    case "sentry":
      return resolveSentryToken(options);
    case "neon":
      return resolveNeonToken(options);
    case "planetscale":
      return resolvePlanetScaleToken(options);
    default:
      throw unknownProvider(providerId);
  }
}

/**
 * Explicitly connect a provider. Requires prior `combie init`.
 * Credentials are stored separately from domain data (0600 file).
 */
export async function connectProvider(
  options: ConnectOptions,
): Promise<ConnectResult> {
  const providerId = options.providerId.toLowerCase();
  const provider = getProvider(providerId);
  if (!provider) {
    throw unknownProvider(providerId);
  }

  const store = new Store(options.baseDir);
  try {
    if (!store.isInitialized()) {
      throw notInitialized();
    }
    store.init();

    const token = resolveToken(providerId, options);

    const auth = await provider.authenticate(token, {
      organization: options.organization,
    });
    if (!auth.ok) {
      throw new CombieError(
        "AUTH_FAILED",
        `${provider.name} authentication failed: ${auth.message}`,
      );
    }

    // Sync requires a string accountId. Fail at connect so identity is never
    // half-persisted (display name without id).
    const accountId =
      typeof auth.accountId === "string" && auth.accountId.trim() !== ""
        ? auth.accountId
        : undefined;
    if (!accountId) {
      throw new CombieError(
        "NO_ACCOUNT",
        `${provider.name} authentication succeeded but no account identity was returned.\n` +
          `Reconnect with a token that can read the authenticated account, or report this as a provider bug.`,
      );
    }

    const creds = new CredentialsStore(options.baseDir);
    creds.setCredential(providerId, token);

    store.upsertProvider({
      id: providerId,
      name: provider.name,
      status: "connected",
      lastSyncAt: null,
      config: {
        accountId,
        accountName: auth.accountName ?? null,
      },
    });

    const accountPart = auth.accountName
      ? ` (account: ${auth.accountName})`
      : ` (account: ${accountId})`;

    return {
      provider: provider.name,
      accountId,
      accountName: auth.accountName,
      message:
        `Connected ${provider.name}${accountPart}.\n` +
        `Credential stored in the local restricted-permission credentials file.\n` +
        `Next: ${BINARY_NAME} sync`,
    };
  } finally {
    store.close();
  }
}
