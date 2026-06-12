import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as ui from "./ui.mjs";

const CONFIG_DIR = ".cli";
const CONFIG_FILE = "config.json";
const CREDENTIALS_FILE = "credentials.json";
const THEME_CONFIG_FILE = "tiendu.config.json";

/**
 * @typedef {{ storeId?: number, apiBaseUrl: string, previewKey?: string }} TienduConfig
 * @typedef {{ apiKey: string }} TienduCredentials
 * @typedef {{ compileScripts: boolean, compileStyles: boolean, postcss: boolean }} TienduPipelineConfig
 * @typedef {{ pipeline?: Partial<TienduPipelineConfig> }} TienduThemeConfig
 */

const getConfigDir = () => path.resolve(process.cwd(), CONFIG_DIR);
const getConfigPath = () => path.join(getConfigDir(), CONFIG_FILE);
const getCredentialsPath = () => path.join(getConfigDir(), CREDENTIALS_FILE);
const getThemeConfigPath = () => path.resolve(process.cwd(), THEME_CONFIG_FILE);

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * @param {TienduThemeConfig} themeConfig
 * @returns {TienduThemeConfig}
 */
const validateThemeConfig = (themeConfig) => {
  if (!isPlainObject(themeConfig)) {
    throw new Error("tiendu.config.json must contain a JSON object.");
  }

  if (themeConfig.pipeline !== undefined && !isPlainObject(themeConfig.pipeline)) {
    throw new Error('tiendu.config.json: "pipeline" must be an object.');
  }

  for (const key of ["compileScripts", "compileStyles", "postcss"]) {
    const value = themeConfig.pipeline?.[key];
    if (value !== undefined && typeof value !== "boolean") {
      throw new Error(`tiendu.config.json: "pipeline.${key}" must be true or false.`);
    }
  }

  if (themeConfig.sync !== undefined || themeConfig.preserveInstances !== undefined) {
    throw new Error(
      "tiendu.config.json state sync options were removed. Use --override-state or --preserve-state.",
    );
  }

  return themeConfig;
};

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

/** @returns {Promise<TienduThemeConfig | null>} */
export const readThemeConfig = async () => {
  try {
    const raw = await readFile(getThemeConfigPath(), "utf-8");

    try {
      return validateThemeConfig(JSON.parse(raw));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid tiendu.config.json: ${error.message}`);
      }
      throw error;
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

/**
 * @param {TienduThemeConfig | null} themeConfig
 * @returns {TienduPipelineConfig}
 */
export const getThemePipelineConfig = (themeConfig) => ({
  compileScripts: themeConfig?.pipeline?.compileScripts === true,
  compileStyles: themeConfig?.pipeline?.compileStyles === true,
  postcss: themeConfig?.pipeline?.postcss === true,
});

/** @returns {Promise<TienduPipelineConfig>} */
export const readThemePipelineConfig = async () =>
  getThemePipelineConfig(await readThemeConfig());

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

/** @returns {string} */
export const getDistDir = () => path.resolve(process.cwd(), "dist");

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

  if (requireStore && !config.storeId) {
    console.error(
      "Error: no store selected. Run tiendu stores list and tiendu stores set <id>.",
    );
    process.exit(1);
  }

  return { config, credentials };
};
