import { loadConfigOrFail, writeConfig } from "./config.mjs";
import { apiFetch } from "./api.mjs";

const buildPreviewUrl = (apiBaseUrl, previewHostname) => {
  const base = new URL(apiBaseUrl);
  const hasExplicitPort = previewHostname.includes(":");
  return `${base.protocol}//${previewHostname}${!hasExplicitPort && base.port ? `:${base.port}` : ""}/`;
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
        "Ya existe un preview para esta tienda. Eliminalo antes de crear uno nuevo.";
      return { ok: false, error: message };
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Error del servidor: ${response.status}${body ? ` — ${body}` : ""}`,
      };
    }

    const preview = await response.json();
    return { ok: true, data: preview };
  } catch (error) {
    return {
      ok: false,
      error: `No se pudo crear el preview: ${error.message}`,
    };
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
      return { ok: false, error: `Error del servidor: ${response.status}` };
    }

    const body = await response.json();
    const previews = body?.previews ?? [];
    return { ok: true, data: previews };
  } catch (error) {
    return { ok: false, error: `No se pudo listar previews: ${error.message}` };
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
      {
        method: "DELETE",
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Error del servidor: ${response.status}${body ? ` — ${body}` : ""}`,
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `No se pudo eliminar el preview: ${error.message}`,
    };
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
      {
        method: "POST",
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Error del servidor: ${response.status}${body ? ` — ${body}` : ""}`,
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `No se pudo publicar el preview: ${error.message}`,
    };
  }
};

// ---------------------------------------------------------------------------
// CLI commands
// ---------------------------------------------------------------------------

export const previewCreate = async (name) => {
  const { config, credentials } = await loadConfigOrFail();

  console.log("");
  console.log("Creando preview...");

  const result = await createPreview(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
    name,
  );

  if (!result.ok) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  const preview = result.data;
  console.log(`Preview creado: ${preview.previewKey}`);
  console.log(
    `URL: ${buildPreviewUrl(config.apiBaseUrl, preview.previewHostname)}`,
  );
  console.log("");

  // Save preview key to config
  await writeConfig({ ...config, previewKey: preview.previewKey });
};

export const previewList = async () => {
  const { config, credentials } = await loadConfigOrFail();

  const result = await listPreviews(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
  );

  if (!result.ok) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  console.log("");
  if (result.data.length === 0) {
    console.log("No hay previews para esta tienda.");
  } else {
    console.log("Previews:");
    for (const preview of result.data) {
      const active =
        config.previewKey === preview.previewKey ? " (activo)" : "";
      console.log(
        `  ${preview.previewKey}  ${preview.name}  ${buildPreviewUrl(config.apiBaseUrl, preview.previewHostname)}${active}`,
      );
    }
  }
  console.log("");
};

export const previewDelete = async () => {
  const { config, credentials } = await loadConfigOrFail();

  if (!config.previewKey) {
    console.error("No hay preview activo. Creá uno con: tiendu preview create");
    process.exit(1);
  }

  console.log("");
  console.log(`Eliminando preview ${config.previewKey}...`);

  const result = await deletePreview(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
    config.previewKey,
  );

  if (!result.ok) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  console.log("Preview eliminado.");
  console.log("");

  // Remove preview key from config
  const { previewKey, ...rest } = config;
  await writeConfig(rest);
};

export const previewOpen = async () => {
  const { config } = await loadConfigOrFail();

  if (!config.previewKey) {
    console.error("No hay preview activo. Creá uno con: tiendu preview create");
    process.exit(1);
  }

  // Find the preview to get its hostname
  const { credentials } = await loadConfigOrFail();
  const result = await listPreviews(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
  );

  if (!result.ok) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  const preview = result.data.find((p) => p.previewKey === config.previewKey);
  if (!preview) {
    console.error("El preview activo ya no existe en el servidor.");
    process.exit(1);
  }

  const url = buildPreviewUrl(config.apiBaseUrl, preview.previewHostname);
  console.log(`Abriendo ${url}...`);

  // Open URL in browser
  const { exec } = await import("node:child_process");
  const platform = process.platform;
  const cmd =
    platform === "darwin"
      ? "open"
      : platform === "win32"
        ? "start"
        : "xdg-open";
  exec(`${cmd} ${url}`);
};
