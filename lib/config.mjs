import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as ui from "./ui.mjs";

const CONFIG_DIR = ".cli";
const CONFIG_FILE = "config.json";
const CREDENTIALS_FILE = "credentials.json";

/**
 * @typedef {{ storeHandle?: string, storeId?: number, apiBaseUrl: string, previewKey?: string }} TienduConfig
 * @typedef {{ apiKey: string }} TienduCredentials
 */

const getConfigDir = () => path.resolve(process.cwd(), CONFIG_DIR);
const getConfigPath = () => path.join(getConfigDir(), CONFIG_FILE);
const getCredentialsPath = () => path.join(getConfigDir(), CREDENTIALS_FILE);

/** @returns {string} */
export const getProjectDir = () => path.resolve(process.cwd());

/** @returns {Promise<TienduConfig | null>} */
export const readConfig = async () => {
  try {
    const raw = await readFile(getConfigPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** @param {TienduConfig} config */
const withoutLegacyStoreId = (config) => {
  const { storeId: _storeId, ...rest } = config;
  return rest;
};

/** @param {TienduConfig} config */
export const writeConfig = async (config) => {
  const persisted = withoutLegacyStoreId(config);
  await mkdir(getConfigDir(), { recursive: true });
  await writeFile(
    getConfigPath(),
    JSON.stringify(persisted, null, "\t") + "\n",
    "utf-8",
  );
};

/** @returns {Promise<TienduCredentials | null>} */
export const readCredentials = async () => {
  try {
    const raw = await readFile(getCredentialsPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** @param {TienduCredentials} credentials */
export const writeCredentials = async (credentials) => {
  await mkdir(getConfigDir(), { recursive: true });
  await writeFile(
    getCredentialsPath(),
    JSON.stringify(credentials, null, "\t") + "\n",
    "utf-8",
  );
};

const migrateStoreHandle = async (config, credentials) => {
  const stripped = withoutLegacyStoreId(config);

  if (stripped.storeHandle) {
    if (config.storeId) await writeConfig(stripped);
    return stripped;
  }

  if (!config.storeId) return stripped;

  const { fetchUserStores } = await import("./api.mjs");
  const result = await fetchUserStores(config.apiBaseUrl, credentials.apiKey);
  if (!result.ok) {
    ui.log.error(result.error);
    process.exit(1);
  }

  const selectedStore = result.data.find((store) => store.id === config.storeId);
  if (!selectedStore?.handle) {
    console.error(
      "Error: could not migrate storeId to storeHandle. Run tiendu stores list and tiendu stores set <handle>.",
    );
    process.exit(1);
  }

  const nextConfig = { ...stripped, storeHandle: selectedStore.handle };
  await writeConfig(nextConfig);
  return nextConfig;
};

/**
 * @param {{ overrideStateFlag?: boolean, preserveStateFlag?: boolean, prompt?: boolean, commandName?: string }} [options]
 * @returns {Promise<boolean>}
 */
export const resolveOverrideState = async ({
  overrideStateFlag = false,
  preserveStateFlag = false,
  prompt = false,
  commandName = "this command",
} = {}) => {
  if (overrideStateFlag && preserveStateFlag) {
    throw new Error(
      "Use either --override-state or --preserve-state, not both.",
    );
  }

  if (overrideStateFlag) return true;
  if (preserveStateFlag) return false;

  if (!prompt) return false;

  if (!ui.isInteractive()) {
    throw new Error(
      `Use either --override-state or --preserve-state with ${commandName} in non-interactive mode.`,
    );
  }

  const selected = await ui.select({
    message: "How should theme state/configuration be handled?",
    options: [
      {
        value: "preserve",
        label: "Preserve configuration",
        hint: "Skip templates/*.json, sections/*.json, and config/settings_data.json",
      },
      {
        value: "override",
        label: "Override configuration",
        hint: "Include state/configuration files",
      },
    ],
  });

  if (ui.isCancel(selected)) {
    ui.cancel("Cancelled.");
    process.exit(0);
  }

  return selected === "override";
};

/**
 * @param {{ requireStore?: boolean }} [options]
 * @returns {Promise<{ config: TienduConfig, credentials: TienduCredentials }>}
 */
export const loadConfigOrFail = async ({ requireStore = true } = {}) => {
  const config = await readConfig();
  if (!config) {
    console.error("Error: no .cli/config.json found. Run tiendu init first.");
    process.exit(1);
  }

  const credentials = await readCredentials();
  if (!credentials) {
    console.error(
      "Error: no .cli/credentials.json found. Run tiendu init first.",
    );
    process.exit(1);
  }

  const resolvedConfig = await migrateStoreHandle(config, credentials);

  if (requireStore && !resolvedConfig.storeHandle) {
    console.error(
      "Error: no store selected. Run tiendu stores list and tiendu stores set <handle>.",
    );
    process.exit(1);
  }

  return { config: resolvedConfig, credentials };
};
