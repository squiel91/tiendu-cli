import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const CONFIG_DIR = ".cli";
const CONFIG_FILE = "config.json";
const CREDENTIALS_FILE = "credentials.json";
const THEME_CONFIG_FILE = "tiendu.config.json";

/**
 * @typedef {{ storeId: number, apiBaseUrl: string, previewKey?: string }} TienduConfig
 * @typedef {{ apiKey: string }} TienduCredentials
 */

const getConfigDir = () => path.resolve(process.cwd(), CONFIG_DIR);
const getConfigPath = () => path.join(getConfigDir(), CONFIG_FILE);
const getCredentialsPath = () => path.join(getConfigDir(), CREDENTIALS_FILE);

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
export const writeConfig = async (config) => {
  await mkdir(getConfigDir(), { recursive: true });
  await writeFile(
    getConfigPath(),
    JSON.stringify(config, null, "\t") + "\n",
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

/** @returns {Promise<object | null>} */
export const readThemeConfig = async () => {
  try {
    const raw = await readFile(
      path.resolve(process.cwd(), THEME_CONFIG_FILE),
      "utf-8",
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** @returns {Promise<boolean>} */
export const isBuiltTheme = async () => (await readThemeConfig()) !== null;

/** @returns {string} */
export const getDistDir = () => path.resolve(process.cwd(), "dist");

/**
 * @returns {Promise<{ config: TienduConfig, credentials: TienduCredentials }>}
 */
export const loadConfigOrFail = async () => {
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

  return { config, credentials };
};
