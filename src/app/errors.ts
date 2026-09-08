/**
 * User-facing application errors with actionable messages.
 * Never include secrets in messages.
 */

import { supportedProviderIds } from "../provider/registry.ts";
import { BINARY_NAME } from "../cli/constants.ts";

export class CombieError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, message: string, exitCode = 1) {
    super(message);
    this.name = "CombieError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function notInitialized(): CombieError {
  return new CombieError(
    "NOT_INITIALIZED",
    `Combie is not initialized in this directory.\nRun: ${BINARY_NAME} init`,
  );
}

export function providerNotConnected(provider: string): CombieError {
  return new CombieError(
    "PROVIDER_NOT_CONNECTED",
    `${provider} is not connected.\nRun: ${BINARY_NAME} connect ${provider}`,
  );
}

export function unknownProvider(provider: string): CombieError {
  const supported = supportedProviderIds().join(", ");
  return new CombieError(
    "UNKNOWN_PROVIDER",
    `Unknown provider: ${provider}.\nSupported providers: ${supported}`,
  );
}

export function alreadyInitialized(): CombieError {
  return new CombieError(
    "ALREADY_INITIALIZED",
    `Combie is already initialized in this directory.\nNext: ${BINARY_NAME} connect github --use-gh`,
    0,
  );
}
