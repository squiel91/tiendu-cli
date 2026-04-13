import { mkdir, access } from "node:fs/promises";
import path from "node:path";
import { readConfig, readCredentials, writeConfig, writeCredentials } from "./config.mjs";
import { fetchUserStores } from "./api.mjs";
import { formatInitSummary } from "./stores.mjs";
import * as ui from "./ui.mjs";

const DEFAULT_API_BASE_URL = "https://tiendu.uy";

/** @param {string} url */
const normalizeBaseUrl = (url) => (url.endsWith("/") ? url.slice(0, -1) : url);

const resolveBaseUrlOrFail = (baseUrlArg) => {
  const candidate = normalizeBaseUrl((baseUrlArg ?? DEFAULT_API_BASE_URL).trim());
  try {
    new URL(candidate);
  } catch {
    ui.log.error("Invalid base URL.");
    process.exit(1);
  }
  return candidate;
};

const prepareWorkDir = async (dirArg) => {
  if (!dirArg) return;

  const targetDir = path.resolve(process.cwd(), dirArg);

  try {
    await access(targetDir);
    ui.cancel(`Directory "${dirArg}" already exists.`);
    process.exit(1);
  } catch {
    // Safe to create the target directory.
  }

  await mkdir(targetDir, { recursive: true });
  process.chdir(targetDir);
};

const ensureResetAllowed = async (hasExistingSetup) => {
  if (!hasExistingSetup) return;

  const confirmed = await ui.confirm({
    message: "Existing Tiendu configuration found. Reset it and continue?",
  });

  if (ui.isCancel(confirmed) || !confirmed) {
    ui.cancel("Setup cancelled.");
    process.exit(0);
  }
};

const collectInteractiveInputs = async () => {
  ui.intro("Tiendu CLI — Setup");

  const apiKeyInput = await ui.password({
    message: "API Key",
    mask: "*",
    validate: (value) => (!(value ?? "").trim() ? "API Key is required." : undefined),
  });

  if (ui.isCancel(apiKeyInput)) {
    ui.cancel("Setup cancelled.");
    process.exit(0);
  }

  const apiKey = (apiKeyInput ?? "").trim();
  const baseUrlDefault = DEFAULT_API_BASE_URL;
  const baseUrlInput = await ui.text({
    message: "API base URL",
    placeholder: baseUrlDefault,
    defaultValue: baseUrlDefault,
    validate: (value) => {
      const resolved = (value ?? "").trim() || baseUrlDefault;
      try {
        new URL(resolved);
      } catch {
        return "Invalid URL.";
      }
    },
  });

  if (ui.isCancel(baseUrlInput)) {
    ui.cancel("Setup cancelled.");
    process.exit(0);
  }

  const apiBaseUrl = normalizeBaseUrl((baseUrlInput ?? "").trim() || baseUrlDefault);
  return {
    apiKey,
    apiBaseUrl,
    usedDefaultBaseUrl: apiBaseUrl === DEFAULT_API_BASE_URL,
  };
};

const collectDirectInputs = (apiKeyArg, baseUrlArg) => {
  const apiKey = (apiKeyArg ?? "").trim();
  if (!apiKey) {
    ui.log.error("API Key is required. Use: tiendu init <api-key> [base-url]");
    process.exit(1);
  }

  return {
    apiKey,
    apiBaseUrl: resolveBaseUrlOrFail(baseUrlArg),
    usedDefaultBaseUrl: !baseUrlArg,
  };
};

export const init = async ({ dirArg, apiKeyArg, baseUrlArg } = {}) => {
  await prepareWorkDir(dirArg);

  const existingConfig = await readConfig();
  const existingCredentials = await readCredentials();
  const hasExistingSetup = Boolean(existingConfig || existingCredentials);
  const directMode = Boolean(apiKeyArg);

  if (!directMode && !ui.isInteractive()) {
    ui.log.error("Non-interactive init requires an API key. Use: tiendu init <api-key> [base-url] --non-interactive");
    process.exit(1);
  }

  if (!directMode) {
    await ensureResetAllowed(hasExistingSetup);
  }

  const { apiKey, apiBaseUrl, usedDefaultBaseUrl } = directMode
    ? collectDirectInputs(apiKeyArg, baseUrlArg)
    : await collectInteractiveInputs();

  const spinner = ui.spinner();
  spinner.start("Verifying credentials...");

  const storesResult = await fetchUserStores(apiBaseUrl, apiKey);
  if (!storesResult.ok) {
    spinner.stop("Failed to verify credentials.", 1);
    ui.log.error(storesResult.error);
    process.exit(1);
  }

  const stores = storesResult.data;
  if (stores.length === 0) {
    spinner.stop("No stores found.", 1);
    ui.log.error("Your API key does not have access to any stores.");
    process.exit(1);
  }

  const selectedStore = stores.length === 1 ? stores[0] : null;
  spinner.stop(`Connected to Tiendu. ${stores.length} store${stores.length === 1 ? "" : "s"} available.`);

  await writeCredentials({ apiKey });
  await writeConfig({
    apiBaseUrl,
    ...(selectedStore ? { storeId: selectedStore.id } : {}),
  });

  const summary = formatInitSummary({
    apiBaseUrl,
    usedDefaultBaseUrl,
    stores,
    selectedStore,
  });

  if (ui.isInteractive()) {
    ui.note(summary, "Setup complete");
  } else {
    ui.log.message(summary);
  }

  ui.outro("Configuration saved to .cli/");
};
