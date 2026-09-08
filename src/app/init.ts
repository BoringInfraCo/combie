import { Store } from "../storage/store.ts";
import { alreadyInitialized } from "./errors.ts";
import { BINARY_NAME } from "../cli/constants.ts";

export interface InitResult {
  created: boolean;
  path: string;
  message: string;
}

/**
 * Initialize local Combie state. Idempotent and safe to re-run.
 */
export function initCombie(baseDir: string): InitResult {
  const store = new Store(baseDir);
  try {
    if (store.isInitialized()) {
      // Still ensure schema is present; do not corrupt state.
      store.init();
      return {
        created: false,
        path: store.stateDir,
        message: alreadyInitialized().message,
      };
    }
    store.init();
    return {
      created: true,
      path: store.stateDir,
      message:
        `Initialized Combie at ${store.stateDir}\n` +
        `Next: ${BINARY_NAME} connect github --use-gh`,
    };
  } finally {
    store.close();
  }
}
