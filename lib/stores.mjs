import { fetchUserStores } from "./api.mjs";
import { loadConfigOrFail, writeConfig } from "./config.mjs";
import * as ui from "./ui.mjs";

const formatStoreLabel = (store, { active = false } = {}) =>
  `${store.name} (ID: ${store.id})${active ? " [active]" : ""}`;

const getStoresOrFail = async () => {
  const { config, credentials } = await loadConfigOrFail({ requireStore: false });
  const result = await fetchUserStores(config.apiBaseUrl, credentials.apiKey);
  if (!result.ok) {
    ui.log.error(result.error);
    process.exit(1);
  }

  return { config, credentials, stores: result.data };
};

export const storesList = async () => {
  const spinner = ui.spinner();
  spinner.start("Fetching stores...");

  const { config, stores } = await getStoresOrFail();
  spinner.stop(`Found ${stores.length} store${stores.length === 1 ? "" : "s"}.`);

  if (stores.length === 0) {
    ui.log.warn("No stores available for this API key.");
    return;
  }

  ui.log.message("Stores:");
  for (const store of stores) {
    ui.log.message(`- ${formatStoreLabel(store, { active: config.storeId === store.id })}`);
  }

  if (!config.storeId) {
    ui.log.info("No active store selected.");
    ui.log.info("Next step: tiendu stores set <store-id>");
  }
};

export const storesSet = async (storeIdArg) => {
  const storeId = Number(storeIdArg);
  if (!Number.isInteger(storeId) || storeId <= 0) {
    ui.log.error("Invalid store id. Use: tiendu stores set <store-id>");
    process.exit(1);
  }

  const spinner = ui.spinner();
  spinner.start("Validating store...");

  const { config, stores } = await getStoresOrFail();
  const selectedStore = stores.find((store) => store.id === storeId);

  if (!selectedStore) {
    spinner.stop("Store not found.", 1);
    ui.log.error("Store not found for this API key. Run tiendu stores list to see available stores.");
    process.exit(1);
  }

  const nextConfig = config.storeId === storeId
    ? config
    : { apiBaseUrl: config.apiBaseUrl, storeId };

  await writeConfig(nextConfig);
  spinner.stop(`Active store set to ${selectedStore.name} (ID: ${selectedStore.id}).`);
};

export const formatInitSummary = ({ apiBaseUrl, usedDefaultBaseUrl, stores, selectedStore, previewKey }) => {
  const lines = ["Status: Connected."];

  if (usedDefaultBaseUrl) {
    lines.push(`Base URL: ${apiBaseUrl} (default)`);
  } else {
    lines.push(`Base URL: ${apiBaseUrl}`);
  }

  if (selectedStore) {
    lines.push(`Store: ${selectedStore.name} (ID: ${selectedStore.id})${stores.length === 1 ? " [auto-selected]" : ""}`);
    if (previewKey) {
      lines.push(`Preview: ${previewKey} [attached]`);
    } else {
      lines.push("Preview: live theme (no preview attached)");
    }
    return lines.join("\n");
  }

  lines.push(`Possible stores to select: ${stores.length}`);
  for (const store of stores) {
    lines.push(`- ${store.name} (ID: ${store.id})`);
  }
  lines.push("No active store selected.");
  lines.push("Continue by running: tiendu stores set <store-id>");

  return lines.join("\n");
};
