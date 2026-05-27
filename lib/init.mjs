import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { readConfig, readCredentials, writeConfig, writeCredentials } from "./config.mjs";
import { fetchUserStores, fetchPreview } from "./api.mjs";
import { formatInitSummary } from "./stores.mjs";
import { listPreviews, createPreview, getPreviewDisplayName, getPreviewUrl } from "./preview.mjs";
import { pull } from "./pull.mjs";
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

const checkTargetDir = async (dirArg) => {
  if (dirArg) {
    const targetDir = path.resolve(process.cwd(), dirArg);
    try {
      const entries = await readdir(targetDir);
      const hasContent = entries.filter((n) => !n.startsWith(".")).length > 0;
      if (hasContent && !ui.isInteractive()) {
        ui.log.error(`Directory "${dirArg}" already exists and is not empty.`);
        process.exit(1);
      }

      if (hasContent) {
        const confirmed = await ui.confirm({
          message: `Directory "${dirArg}" already exists. Overwrite its contents?`,
        });
        if (ui.isCancel(confirmed) || !confirmed) {
          ui.cancel("Setup cancelled.");
          process.exit(0);
        }
      }
    } catch {
      // Directory doesn't exist — fine
    }
    return;
  }

  try {
    const entries = await readdir(process.cwd());
    const hasContent = entries.filter((n) => !n.startsWith(".") && n !== ".cli").length > 0;
    if (hasContent && ui.isInteractive()) {
      const confirmed = await ui.confirm({
        message: "Current directory is not empty. Overwrite its contents?",
      });
      if (ui.isCancel(confirmed) || !confirmed) {
        ui.cancel("Setup cancelled.");
        process.exit(0);
      }
    }
  } catch {
    // Can't happen for cwd
  }
};

const enterTargetDir = async (dirArg) => {
  if (!dirArg) return;
  const targetDir = path.resolve(process.cwd(), dirArg);
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

export const init = async ({ dirArg, apiKeyArg, baseUrlArg, previewKeyArg } = {}) => {
  const existingConfig = await readConfig();
  const existingCredentials = await readCredentials();
  const hasExistingSetup = Boolean(existingConfig || existingCredentials);
  const directMode = Boolean(apiKeyArg);

  if (!directMode && !ui.isInteractive()) {
    ui.log.error("Non-interactive init requires an API key. Use: tiendu init <api-key> [base-url] --non-interactive");
    process.exit(1);
  }

  if (!directMode && !dirArg) {
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

  let selectedStore = stores.length === 1 ? stores[0] : null;

  if (!selectedStore && ui.isInteractive()) {
    spinner.stop(`Connected to Tiendu. ${stores.length} stores available.`);

    const storeOptions = stores.map((store) => ({
      value: store.id,
      label: store.name,
      hint: `ID: ${store.id}`,
    }));

    const chosen = await ui.select({
      message: "Select a store",
      options: storeOptions,
    });

    if (ui.isCancel(chosen)) {
      ui.cancel("Setup cancelled.");
      process.exit(1);
    }

    selectedStore = stores.find((s) => s.id === chosen) ?? null;
  }

  if (selectedStore || stores.length === 1) {
    spinner.stop(
      `Connected to Tiendu. ${stores.length} store${stores.length === 1 ? "" : "s"} available.`,
    );
  } else {
    spinner.stop(
      `Connected to Tiendu. ${stores.length} stores available.`,
    );
  }

  let previewKey = null;

  if (previewKeyArg && selectedStore) {
    const result = await fetchPreview(apiBaseUrl, apiKey, selectedStore.id, previewKeyArg);
    if (result.ok) {
      previewKey = previewKeyArg;
      const url = getPreviewUrl(apiBaseUrl, result.data);
      const displayName = getPreviewDisplayName(result.data);
      ui.log.message(`Preview "${displayName}" (${previewKey})`);
      ui.log.message(`  ${url}`);
    } else {
      ui.log.error(`Preview ${previewKeyArg} not found.`);
      process.exit(1);
    }
  } else if (selectedStore && ui.isInteractive()) {
    const listResult = await listPreviews(apiBaseUrl, apiKey, selectedStore.id);
    let previews = [];
    if (listResult.ok) {
      previews = listResult.data;
    }

    const LIVE_VALUE = "__live__";
    const CREATE_NEW_VALUE = "__create_new__";

    const options = [
      {
        value: LIVE_VALUE,
        label: "Live theme",
        hint: "No preview — work directly with the live storefront",
      },
      ...previews.map((p) => ({
        value: p.previewKey,
        label: `${getPreviewDisplayName(p)} (${p.previewKey})`,
      })),
      { value: CREATE_NEW_VALUE, label: "Create a new preview" },
    ];

    const chosen = await ui.select({
      message: "Select a preview",
      options,
    });

    if (ui.isCancel(chosen)) {
      ui.cancel("Setup cancelled.");
      process.exit(1);
    }

    if (chosen === LIVE_VALUE) {
      // Live theme — no preview key
    } else if (chosen === CREATE_NEW_VALUE) {
      const nameInput = await ui.text({
        message: "Preview name (optional)",
        placeholder: "Press Enter to skip",
        defaultValue: "",
      });

      if (ui.isCancel(nameInput)) {
        ui.cancel("Setup cancelled.");
        process.exit(1);
      }

      const name = (nameInput ?? "").trim();
      const createSpinner = ui.spinner();
      createSpinner.start("Creating preview...");

      const createResult = await createPreview(
        apiBaseUrl,
        apiKey,
        selectedStore.id,
        name,
      );

      if (!createResult.ok) {
        createSpinner.stop("Failed to create preview.", 1);
        ui.log.error(createResult.error);
        process.exit(1);
      }

      const preview = createResult.data;
      previewKey = preview.previewKey;
      const url = getPreviewUrl(apiBaseUrl, preview);
      const displayName = getPreviewDisplayName(preview);
      createSpinner.stop(`Preview "${displayName}" created (${previewKey})`);
      ui.log.message(`  ${url}`);
    } else {
      const selectedPreview = previews.find((p) => p.previewKey === chosen);
      previewKey = chosen;
      if (selectedPreview) {
        const displayName = getPreviewDisplayName(selectedPreview);
        const url = getPreviewUrl(apiBaseUrl, selectedPreview);
        ui.log.message(`Preview "${displayName}" (${previewKey})`);
        ui.log.message(`  ${url}`);
      }
    }
  }

  await checkTargetDir(dirArg);
  await enterTargetDir(dirArg);

  await writeCredentials({ apiKey });
  await writeConfig({
    apiBaseUrl,
    ...(selectedStore ? { storeId: selectedStore.id } : {}),
    ...(previewKey ? { previewKey } : {}),
  });

  if (selectedStore) {
    await pull({ previewKey: previewKey || undefined, confirmSourceSync: false });
  }

  const summary = formatInitSummary({
    apiBaseUrl,
    usedDefaultBaseUrl,
    stores,
    selectedStore,
    previewKey,
  });

  if (ui.isInteractive()) {
    ui.note(summary, "Setup complete");
  } else {
    ui.log.message(summary);
  }

  ui.outro("Configuration saved to .cli/");
};
