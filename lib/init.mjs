import * as p from "@clack/prompts";
import {
  readConfig,
  readCredentials,
  writeConfig,
  writeCredentials,
} from "./config.mjs";
import { fetchUserStores } from "./api.mjs";

/** @param {string} key */
const maskApiKey = (key) => {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "..." + key.slice(-4);
};

/** @param {string} url */
const normalizeBaseUrl = (url) => {
  return url.endsWith("/") ? url.slice(0, -1) : url;
};

export const init = async () => {
  const existingConfig = await readConfig();
  const existingCredentials = await readCredentials();

  p.intro("Tiendu CLI — Setup");

  // ─── API Key ──────────────────────────────────────────────────────────────
  const apiKeyDefault = existingCredentials?.apiKey ?? "";

  const apiKeyInput = await p.password({
    message: "API Key",
    mask: "*",
    validate: (value) => {
      const resolved = (value ?? "").trim() || apiKeyDefault;
      if (!resolved) return "API Key is required.";
    },
  });

  if (p.isCancel(apiKeyInput)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const apiKey = apiKeyInput.trim() || apiKeyDefault;

  // ─── API Base URL ─────────────────────────────────────────────────────────
  const baseUrlDefault = existingConfig?.apiBaseUrl ?? "https://tiendu.uy";

  const baseUrlInput = await p.text({
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

  if (p.isCancel(baseUrlInput)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const apiBaseUrl = normalizeBaseUrl(
    (baseUrlInput ?? "").trim() || baseUrlDefault,
  );

  // ─── Fetch stores (validates API key implicitly) ───────────────────────────
  const spinner = p.spinner();
  spinner.start("Verifying credentials and fetching stores...");

  const storesResult = await fetchUserStores(apiBaseUrl, apiKey);

  if (!storesResult.ok) {
    spinner.stop("Could not verify credentials.", 1);
    p.cancel(storesResult.error);
    process.exit(1);
  }

  const stores = storesResult.data;

  if (stores.length === 0) {
    spinner.stop("No stores found.", 1);
    p.cancel("Your API Key does not have access to any store.");
    process.exit(1);
  }

  spinner.stop(
    `${stores.length} store${stores.length === 1 ? "" : "s"} found.`,
  );

  // ─── Select store ─────────────────────────────────────────────────────────
  let storeId;

  if (stores.length === 1) {
    storeId = stores[0].id;
    p.note(`${stores[0].name} (ID: ${storeId})`, "Store selected");
  } else {
    const selectedId = await p.select({
      message: "Select a store",
      options: stores.map((store) => ({
        value: store.id,
        label: store.name,
        hint: `ID: ${store.id}`,
      })),
      initialValue: existingConfig?.storeId ?? stores[0].id,
    });

    if (p.isCancel(selectedId)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    storeId = selectedId;
  }

  // ─── Save ─────────────────────────────────────────────────────────────────
  await writeConfig({ storeId, apiBaseUrl });
  await writeCredentials({ apiKey });

  p.note(
    [
      'Run "tiendu pull" to download the theme.',
      "",
      "Note: enable dev mode in the Tiendu platform",
      "(Settings > General) for preview data to show correctly.",
    ].join("\n"),
    "Next steps",
  );

  p.outro("Configuration saved to .cli/");
};
