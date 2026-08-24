import { fetchUserStores } from "./api.mjs";
import { loadConfigOrFail, writeConfig } from "./config.mjs";
import * as ui from "./ui.mjs";

const formatStoreLabel = (store, { active = false } = {}) =>
  `${store.name} (${store.handle})${active ? " [active]" : ""}`;

const findStoreByHandle = (stores, storeHandle) => {
  const trimmed = String(storeHandle ?? "").trim();
  if (!trimmed) return null;

  return (
    stores.find(
      (store) => store.handle?.toLowerCase() === trimmed.toLowerCase(),
    ) ?? null
  );
};

const getStoresOrFail = async () => {
  const { config, credentials } = await loadConfigOrFail({ requireStore: false });
  const result = await fetchUserStores(config.apiBaseUrl, credentials.apiKey);
  if (!result.ok) {
    ui.log.error(result.error);
    process.exit(1);
  }

  return { config, stores: result.data };
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
    ui.log.message(
      `- ${formatStoreLabel(store, { active: config.storeHandle === store.handle })}`,
    );
  }

  if (!config.storeHandle) {
    ui.log.info("No active store selected.");
    ui.log.info("Next step: tiendu stores set <store-handle>");
  }
};

export const storesSet = async (storeHandleArg) => {
  const storeHandle = String(storeHandleArg ?? "").trim();
  if (!storeHandle) {
    ui.log.error("Missing store handle. Use: tiendu stores set <store-handle>");
    process.exit(1);
  }

  if (/^\d+$/.test(storeHandle)) {
    ui.log.error(
      "Store ids are no longer accepted. Use the store handle from tiendu stores list.",
    );
    process.exit(1);
  }

  const spinner = ui.spinner();
  spinner.start("Validating store...");

  const { config, stores } = await getStoresOrFail();
  const selectedStore = findStoreByHandle(stores, storeHandle);

  if (!selectedStore?.handle) {
    spinner.stop("Store not found.", 1);
    ui.log.error(
      "Store not found for this API key. Run tiendu stores list to see available stores.",
    );
    process.exit(1);
  }

  const nextConfig =
    config.storeHandle === selectedStore.handle
      ? { ...config, storeHandle: selectedStore.handle }
      : { apiBaseUrl: config.apiBaseUrl, storeHandle: selectedStore.handle };

  await writeConfig(nextConfig);
  spinner.stop(
    `Active store set to ${selectedStore.name} (${selectedStore.handle}).`,
  );
};

export const formatInitSummary = ({
  apiBaseUrl,
  usedDefaultBaseUrl,
  stores,
  selectedStore,
  previewKey,
}) => {
  const lines = ["Status: Connected."];

  if (usedDefaultBaseUrl) {
    lines.push(`Base URL: ${apiBaseUrl} (default)`);
  } else {
    lines.push(`Base URL: ${apiBaseUrl}`);
  }

  if (selectedStore) {
    lines.push(
      `Store: ${selectedStore.name} (${selectedStore.handle})${stores.length === 1 ? " [auto-selected]" : ""}`,
    );
    if (previewKey) {
      lines.push(`Preview: ${previewKey} [attached]`);
    } else {
      lines.push("Preview: live theme (no preview attached)");
    }
    return lines.join("\n");
  }

  lines.push(`Possible stores to select: ${stores.length}`);
  for (const store of stores) {
    lines.push(`- ${store.name} (${store.handle})`);
  }
  lines.push("No active store selected.");
  lines.push("Continue by running: tiendu stores set <store-handle>");

  return lines.join("\n");
};
