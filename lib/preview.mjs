import * as p from "@clack/prompts";
import { loadConfigOrFail, writeConfig } from "./config.mjs";
import { apiFetch } from "./api.mjs";

const buildPreviewUrl = (apiBaseUrl, previewHostname) => {
  const base = new URL(apiBaseUrl);
  const hasExplicitPort = previewHostname.includes(":");
  return `${base.protocol}//${previewHostname}${!hasExplicitPort && base.port ? `:${base.port}` : ""}/`;
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
        body: JSON.stringify({ name: name ?? "Dev" }),
      },
    );

    if (response.status === 409) {
      const body = await response.json().catch(() => ({}));
      const message =
        body?.error?.message ??
        "A preview already exists for this store. Delete it first with: tiendu preview delete";
      return { ok: false, error: message };
    }

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
// CLI commands
// ---------------------------------------------------------------------------

export const previewCreate = async (name) => {
  const { config, credentials } = await loadConfigOrFail();

  const spinner = p.spinner();
  spinner.start("Creating preview...");

  const result = await createPreview(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
    name,
  );

  if (!result.ok) {
    spinner.stop("Failed to create preview.", 1);
    p.log.error(result.error);
    process.exit(1);
  }

  const preview = result.data;
  const url = buildPreviewUrl(config.apiBaseUrl, preview.previewHostname);
  spinner.stop(`Preview created: ${url}`);

  await writeConfig({ ...config, previewKey: preview.previewKey });
};

export const previewList = async () => {
  const { config, credentials } = await loadConfigOrFail();

  const spinner = p.spinner();
  spinner.start("Fetching previews...");

  const result = await listPreviews(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
  );

  if (!result.ok) {
    spinner.stop("Failed to fetch previews.", 1);
    p.log.error(result.error);
    process.exit(1);
  }

  if (result.data.length === 0) {
    spinner.stop("No previews for this store.");
    return;
  }

  spinner.stop(
    `${result.data.length} preview${result.data.length === 1 ? "" : "s"}:`,
  );

  const activePreview = resolveActivePreview(result.data, config.previewKey);

  for (const preview of result.data) {
    const active =
      activePreview?.previewKey === preview.previewKey ? " ← active" : "";
    const url = buildPreviewUrl(config.apiBaseUrl, preview.previewHostname);
    p.log.message(`  ${preview.name}  ${url}${active}`);
  }
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

  const result = await listPreviews(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
  );

  if (!result.ok) {
    p.log.error(result.error);
    process.exit(1);
  }

  const preview = resolveActivePreview(result.data, config.previewKey);
  if (!preview) {
    p.log.error(
      result.data.length === 0
        ? "No previews found for this store."
        : "Run tiendu preview list to inspect available previews.",
    );
    process.exit(1);
  }

  const url = buildPreviewUrl(config.apiBaseUrl, preview.previewHostname);

  p.note(
    [
      `Name: ${preview.name || "Unnamed preview"}`,
      `URL: ${url}`,
      `Created: ${formatRelativeDate(preview.createdAt)}`,
    ].join("\n"),
    "Active preview",
  );
};

export const previewDelete = async () => {
  const { config, credentials } = await loadConfigOrFail();

  const listResult = await listPreviews(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
  );
  if (!listResult.ok) {
    p.log.error(listResult.error);
    process.exit(1);
  }

  const activePreview = resolveActivePreview(
    listResult.data,
    config.previewKey,
  );
  if (!activePreview) {
    p.log.error(
      listResult.data.length === 0
        ? "No previews found for this store."
        : "Could not determine the active preview. Run tiendu preview list first.",
    );
    process.exit(1);
  }

  const confirmed = await p.confirm({
    message: `Delete preview ${activePreview.previewKey}?`,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const spinner = p.spinner();
  spinner.start("Deleting preview...");

  const result = await deletePreview(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
    activePreview.previewKey,
  );

  if (!result.ok) {
    spinner.stop("Failed to delete preview.", 1);
    p.log.error(result.error);
    process.exit(1);
  }

  spinner.stop("Preview deleted.");

  const { previewKey, ...rest } = config;
  await writeConfig(rest);
};

export const previewOpen = async () => {
  const { config, credentials } = await loadConfigOrFail();

  const spinner = p.spinner();
  spinner.start("Fetching preview URL...");

  const result = await listPreviews(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
  );

  if (!result.ok) {
    spinner.stop("Failed to fetch previews.", 1);
    p.log.error(result.error);
    process.exit(1);
  }

  const preview = resolveActivePreview(result.data, config.previewKey);
  if (!preview) {
    spinner.stop("Could not determine the active preview.", 1);
    p.log.error(
      result.data.length === 0
        ? "No previews found for this store."
        : "Run tiendu preview list and then set or recreate the preview.",
    );
    process.exit(1);
  }

  const url = buildPreviewUrl(config.apiBaseUrl, preview.previewHostname);
  spinner.stop(`Opening ${url}`);

  const { exec } = await import("node:child_process");
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  exec(`${cmd} ${url}`);
};
