import { loadConfigOrFail, writeConfig } from "./config.mjs";
import { apiFetch, fetchPreview } from "./api.mjs";
import * as ui from "./ui.mjs";

export const buildPreviewUrl = (apiBaseUrl, previewHostname) => {
  const base = new URL(apiBaseUrl);
  const hasExplicitPort = previewHostname.includes(":");
  return `${base.protocol}//${previewHostname}${!hasExplicitPort && base.port ? `:${base.port}` : ""}/`;
};

const formatShortDateTime = (value) => {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";

  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${month} ${day} ${hours}:${minutes}`;
};

export const getPreviewDisplayName = (preview) =>
  preview.name || `${formatShortDateTime(preview.createdAt)} preview (no name)`;

export const getPreviewUrl = (apiBaseUrl, preview) =>
  buildPreviewUrl(apiBaseUrl, preview.previewHostname);

export const fetchPreviewDetails = async (
  apiBaseUrl,
  apiKey,
  storeId,
  previewKey,
) => {
  const result = await fetchPreview(apiBaseUrl, apiKey, storeId, previewKey);
  if (!result.ok) return result;

  return {
    ok: true,
    data: {
      preview: result.data,
      displayName: getPreviewDisplayName(result.data),
      url: getPreviewUrl(apiBaseUrl, result.data),
    },
  };
};

/**
 * @param {Array<any>} previews
 * @param {string | undefined} previewKey
 * @returns {any | null}
 */
export const resolveActivePreview = (previews, previewKey) => {
  if (previewKey) {
    return (
      previews.find((preview) => preview.previewKey === previewKey) ?? null
    );
  }

  if (previews.length === 1) {
    return previews[0];
  }

  return null;
};

/**
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @param {number} storeId
 * @param {string} [name]
 * @returns {Promise<{ ok: true, data: any } | { ok: false, error: string }>}
 */
export const createPreview = async (apiBaseUrl, apiKey, storeId, name) => {
  try {
    const response = await apiFetch(
      apiBaseUrl,
      apiKey,
      `/api/v2/stores/${storeId}/theme-previews`,
      {
        method: "POST",
        body: JSON.stringify({ name: name ?? "" }),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Server error: ${response.status}${body ? ` — ${body}` : ""}`,
      };
    }

    const preview = await response.json();
    return { ok: true, data: preview };
  } catch (error) {
    return { ok: false, error: `Could not create preview: ${error.message}` };
  }
};

/**
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @param {number} storeId
 * @returns {Promise<{ ok: true, data: any[] } | { ok: false, error: string }>}
 */
export const listPreviews = async (apiBaseUrl, apiKey, storeId) => {
  try {
    const response = await apiFetch(
      apiBaseUrl,
      apiKey,
      `/api/v2/stores/${storeId}/theme-previews`,
    );
    if (!response.ok) {
      return { ok: false, error: `Server error: ${response.status}` };
    }
    const body = await response.json();
    return { ok: true, data: body?.previews ?? [] };
  } catch (error) {
    return { ok: false, error: `Could not list previews: ${error.message}` };
  }
};

/**
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @param {number} storeId
 * @param {string} previewKey
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export const deletePreview = async (
  apiBaseUrl,
  apiKey,
  storeId,
  previewKey,
) => {
  try {
    const response = await apiFetch(
      apiBaseUrl,
      apiKey,
      `/api/v2/stores/${storeId}/theme-previews/${previewKey}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Server error: ${response.status}${body ? ` — ${body}` : ""}`,
      };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Could not delete preview: ${error.message}` };
  }
};

/**
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @param {number} storeId
 * @param {string} previewKey
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export const publishPreview = async (
  apiBaseUrl,
  apiKey,
  storeId,
  previewKey,
) => {
  try {
    const response = await apiFetch(
      apiBaseUrl,
      apiKey,
      `/api/v2/stores/${storeId}/theme-previews/${previewKey}/publish`,
      { method: "POST" },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Server error: ${response.status}${body ? ` — ${body}` : ""}`,
      };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Could not publish preview: ${error.message}` };
  }
};

// ---------------------------------------------------------------------------
// Shared interactive preview picker
// ---------------------------------------------------------------------------

const CREATE_NEW_VALUE = "__create_new__";

/**
 * Interactively resolve a preview key. Uses attached key if valid, otherwise
 * prompts the user to pick an existing preview or create a new one.
 *
 * @param {{ config: import("./config.mjs").TienduConfig, credentials: import("./config.mjs").TienduCredentials }} opts
 * @returns {Promise<string>} The resolved preview key
 */
export const resolvePreviewKeyInteractively = async ({ config, credentials }) => {
  const { apiBaseUrl, storeId } = config;
  const { apiKey } = credentials;

  // 1. Validate stored key
  if (config.previewKey) {
    const result = await fetchPreview(apiBaseUrl, apiKey, storeId, config.previewKey);
    if (result.ok) {
      return config.previewKey;
    }

    ui.log.warn(`Stored preview ${config.previewKey} was not found. Please select a preview.`);
    const { previewKey: _, ...rest } = config;
    await writeConfig(rest);
  } else {
    ui.log.warn("No preview attached.");
  }

  // 2. List previews
  const listResult = await listPreviews(apiBaseUrl, apiKey, storeId);
  if (!listResult.ok) {
    ui.log.error(listResult.error);
    process.exit(1);
  }

  const previews = listResult.data;
  const singlePreview = resolveActivePreview(previews);

  if (singlePreview) {
    await writeConfig({ ...config, previewKey: singlePreview.previewKey });
    const displayName = getPreviewDisplayName(singlePreview);
    ui.log.success(`Using preview "${displayName}" (${singlePreview.previewKey})`);
    return singlePreview.previewKey;
  }

  if (previews.length === 0) {
    ui.log.info("No previews found for this store.");
    if (!ui.isInteractive()) {
      ui.log.error("Create a preview first with tiendu preview create [name].");
      process.exit(1);
    }
  }

  if (!ui.isInteractive()) {
    ui.log.error("No preview selected. Provide a preview key or attach one with tiendu preview attach <key>.");
    process.exit(1);
  }

  // 3. Show picker
  const options = [
    ...previews.map((preview) => ({
      value: preview.previewKey,
      label: getPreviewDisplayName(preview),
      hint: preview.previewKey,
    })),
    {
      value: CREATE_NEW_VALUE,
      label: "Create a new preview",
    },
  ];

  const selected = await ui.select({
    message: "Select a preview",
    options,
  });

  if (ui.isCancel(selected)) {
    ui.cancel("Cancelled.");
    process.exit(0);
  }

  // 4. Handle create new
  if (selected === CREATE_NEW_VALUE) {
    const nameInput = await ui.text({
      message: "Preview name (optional)",
      placeholder: "Press Enter to skip",
      defaultValue: "",
    });

    if (ui.isCancel(nameInput)) {
      ui.cancel("Cancelled.");
      process.exit(0);
    }

    const name = (nameInput ?? "").trim();
    const spinner = ui.spinner();
    spinner.start("Creating preview...");

    const createResult = await createPreview(apiBaseUrl, apiKey, storeId, name);
    if (!createResult.ok) {
      spinner.stop("Failed to create preview.", 1);
      ui.log.error(createResult.error);
      process.exit(1);
    }

    const preview = createResult.data;
    const displayName = getPreviewDisplayName(preview);
    const url = getPreviewUrl(apiBaseUrl, preview);
    spinner.stop(`Preview "${displayName}" created (${preview.previewKey})`);
    ui.log.message(`  ${url}`);

    await writeConfig({ ...config, previewKey: preview.previewKey });
    return preview.previewKey;
  }

  // 5. Attach to selected preview
  await writeConfig({ ...config, previewKey: selected });
  const selectedPreview = previews.find((p) => p.previewKey === selected);
  const displayName = selectedPreview ? getPreviewDisplayName(selectedPreview) : selected;
  ui.log.success(`Attached to "${displayName}" (${selected})`);

  return selected;
};

// ---------------------------------------------------------------------------
// CLI commands
// ---------------------------------------------------------------------------

export const previewCreate = async (name) => {
  const { config, credentials } = await loadConfigOrFail();

  const spinner = ui.spinner();
  spinner.start("Creating preview...");

  const result = await createPreview(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
    name,
  );

  if (!result.ok) {
    spinner.stop("Failed to create preview.", 1);
    ui.log.error(result.error);
    process.exit(1);
  }

  const preview = result.data;
  const url = getPreviewUrl(config.apiBaseUrl, preview);
  const displayName = getPreviewDisplayName(preview);
  spinner.stop(`Preview "${displayName}" created (${preview.previewKey})`);
  ui.log.message(`  ${url}`);

  await writeConfig({ ...config, previewKey: preview.previewKey });
};

export const previewList = async () => {
  const { config, credentials } = await loadConfigOrFail();

  const spinner = ui.spinner();
  spinner.start("Fetching previews...");

  const result = await listPreviews(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
  );

  if (!result.ok) {
    spinner.stop("Failed to fetch previews.", 1);
    ui.log.error(result.error);
    process.exit(1);
  }

  if (result.data.length === 0) {
    spinner.stop("No previews for this store.");
    return;
  }

  spinner.stop(
    `${result.data.length} preview${result.data.length === 1 ? "" : "s"}:`,
  );

  for (const preview of result.data) {
    const isAttached = config.previewKey === preview.previewKey;
    const indicator = isAttached ? "  \u2190 attached" : "";
    const url = buildPreviewUrl(config.apiBaseUrl, preview.previewHostname);
    const displayName = getPreviewDisplayName(preview);
    ui.log.message(`  ${displayName}  ${url}${indicator}`);
  }

  ui.log.info("Tip: run tiendu preview attach <key> to switch previews.");
};

const formatRelativeDate = (value) => {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60)
    return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24)
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
};

export const previewShow = async () => {
  const { config, credentials } = await loadConfigOrFail();

  if (!config.previewKey) {
    ui.log.warn("No preview attached. Run tiendu preview list or tiendu preview create.");
    process.exit(0);
  }

  const result = await fetchPreview(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
    config.previewKey,
  );

  if (!result.ok) {
    ui.log.warn(`Stored preview ${config.previewKey} was not found.`);
    ui.log.info("Run tiendu preview list to see available previews.");
    process.exit(1);
  }

  const preview = result.data;
  const url = getPreviewUrl(config.apiBaseUrl, preview);
  const displayName = getPreviewDisplayName(preview);

  ui.note(
    [
      `Name: ${displayName}`,
      `Key: ${preview.previewKey}`,
      `URL: ${url}`,
      `Created: ${formatRelativeDate(preview.createdAt)}`,
    ].join("\n"),
    "Attached preview",
  );
};

export const previewAttach = async (keyArg) => {
  const { config, credentials } = await loadConfigOrFail();

  if (!keyArg) {
    if (!ui.isInteractive()) {
      ui.log.error("Preview key required in non-interactive mode. Use: tiendu preview attach <key>");
      process.exit(1);
    }
    await resolvePreviewKeyInteractively({ config, credentials });
    return;
  }

  const spinner = ui.spinner();
  spinner.start("Validating preview...");

  const result = await fetchPreview(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
    keyArg,
  );

  if (!result.ok) {
    spinner.stop("Preview not found.", 1);
    ui.log.error("Preview not found. Run tiendu preview list to see available previews.");
    process.exit(1);
  }

  const preview = result.data;
  const url = getPreviewUrl(config.apiBaseUrl, preview);
  const displayName = getPreviewDisplayName(preview);
  spinner.stop(`Attached to preview "${displayName}" (${preview.previewKey})`);
  ui.log.message(`  ${url}`);

  await writeConfig({ ...config, previewKey: preview.previewKey });
};

export const previewDetach = async () => {
  const { config } = await loadConfigOrFail();

  if (!config.previewKey) {
    ui.log.warn("No preview is currently attached.");
    process.exit(0);
  }

  const detachedKey = config.previewKey;
  const { previewKey: _, ...rest } = config;
  await writeConfig(rest);

  ui.log.success(`Detached from preview ${detachedKey}. No active preview.`);
};

export const previewDelete = async (keyArg) => {
  const { config, credentials } = await loadConfigOrFail();

  let previewKey = keyArg;

  if (!previewKey) {
    if (!config.previewKey) {
      ui.log.warn("No preview attached and no key provided.");
      ui.log.info("Run tiendu preview delete <key> or tiendu preview attach first.");
      process.exit(1);
    }
    previewKey = config.previewKey;
  }

  // Fetch preview to show its name in the confirmation
  const fetchResult = await fetchPreview(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
    previewKey,
  );

  if (!fetchResult.ok) {
    ui.log.error(`Preview ${previewKey} not found.`);
    process.exit(1);
  }

  const displayName = getPreviewDisplayName(fetchResult.data);
  const url = getPreviewUrl(config.apiBaseUrl, fetchResult.data);

  const confirmed = await ui.confirm({
    message: `Delete preview ${previewKey} "${displayName}" (${url})?`,
  });

  if (ui.isCancel(confirmed) || !confirmed) {
    ui.cancel("Cancelled.");
    process.exit(0);
  }

  const spinner = ui.spinner();
  spinner.start("Deleting preview...");

  const result = await deletePreview(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
    previewKey,
  );

  if (!result.ok) {
    spinner.stop("Failed to delete preview.", 1);
    ui.log.error(result.error);
    process.exit(1);
  }

  spinner.stop("Preview deleted.");

  if (config.previewKey === previewKey) {
    const { previewKey: _, ...rest } = config;
    await writeConfig(rest);
  }
};

export const previewOpen = async () => {
  const { config, credentials } = await loadConfigOrFail();

  if (!config.previewKey) {
    ui.log.warn("No preview attached. Run tiendu preview attach or tiendu preview create.");
    process.exit(1);
  }

  const spinner = ui.spinner();
  spinner.start("Fetching preview URL...");

  const result = await fetchPreview(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
    config.previewKey,
  );

  if (!result.ok) {
    spinner.stop("Preview not found.", 1);
    ui.log.error("Stored preview was not found. Run tiendu preview list.");
    process.exit(1);
  }

  const preview = result.data;
  const url = getPreviewUrl(config.apiBaseUrl, preview);
  spinner.stop(`Opening ${url}`);

  const { spawn } = await import("node:child_process");

  if (process.platform === "win32") {
    const child = spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return;
  }

  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(cmd, [url], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
};
