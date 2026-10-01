/**
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @param {string} path
 * @param {{ method?: string, body?: string | Buffer | Uint8Array, contentType?: string, signal?: AbortSignal }} [options]
 * @returns {Promise<Response>}
 */
const REQUEST_TIMEOUT_MS = 30_000;

const isRetriableStatus = (status) =>
  status === 408 || status === 425 || status === 429 || status >= 500;

/** @param {unknown} error */
const formatNetworkError = (error) => {
  if (!(error instanceof Error)) return String(error);
  /** @type {string[]} */
  const parts = [];
  /** @type {Set<object>} */
  const seen = new Set();

  /** @param {unknown} value @param {number} depth */
  const visit = (value, depth) => {
    if (!value || typeof value !== "object" || depth > 4 || seen.has(value)) {
      return;
    }
    seen.add(value);
    if ("code" in value && value.code) parts.push(String(value.code));
    if (value instanceof Error && value.message) parts.push(value.message);
    if ("address" in value && value.address) {
      const port = "port" in value && value.port ? `:${value.port}` : "";
      parts.push(`${value.address}${port}`);
    }
    if ("cause" in value) visit(value.cause, depth + 1);
    if ("errors" in value && Array.isArray(value.errors)) {
      for (const inner of value.errors) visit(inner, depth + 1);
    }
  };

  visit(error.cause, 0);
  const extra = [...new Set(parts)].filter(
    (part) => part && part !== error.message,
  );
  return extra.length > 0 ? `${error.message} (${extra.join(": ")})` : error.message;
};

const apiFetch = (apiBaseUrl, apiKey, path, options = {}) => {
  const url = `${apiBaseUrl}${path}`;
  /** @type {Record<string, string>} */
  const headers = {
    Authorization: `Bearer ${apiKey}`,
  };

  if (options.body && typeof options.body === "string") {
    headers["Content-Type"] = options.contentType ?? "application/json";
  } else if (options.contentType) {
    headers["Content-Type"] = options.contentType;
  }

  return fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body,
    signal: options.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
};

/**
 * @param {Response} response
 * @returns {{ ok: false, error: string } | null}
 */
const checkAuthErrors = (response) => {
  if (response.status === 401) {
    return { ok: false, error: "API Key inválida o sin permisos." };
  }
  if (response.status === 403) {
    return {
      ok: false,
      error: "No tenés acceso a esta tienda con esta API Key.",
    };
  }
  return null;
};

/**
 * Fetch all stores accessible by the current API key.
 * Also serves as API key validation — 401/403 means invalid key.
 *
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @returns {Promise<{ ok: true, data: Array<{ id: number, name: string, handle: string, hostname: string }> } | { ok: false, error: string }>}
 */
export const fetchUserStores = async (apiBaseUrl, apiKey) => {
  try {
    const response = await apiFetch(apiBaseUrl, apiKey, `/api/v2/stores`);

    const authError = checkAuthErrors(response);
    if (authError) return authError;

    if (!response.ok) {
      return {
        ok: false,
        error: `Error del servidor: ${response.status} ${response.statusText}`,
      };
    }

    const stores = await response.json();
    return {
      ok: true,
      data: Array.isArray(stores) ? stores : [],
    };
  } catch (error) {
    return {
      ok: false,
      error: `No se pudo conectar a ${apiBaseUrl}: ${formatNetworkError(error)}`,
    };
  }
};

/**
 * Fetch a single preview by key.
 *
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @param {string} storeHandle
 * @param {string} previewKey
 * @returns {Promise<{ ok: true, data: any } | { ok: false, error: string }>}
 */
export const fetchPreview = async (apiBaseUrl, apiKey, storeHandle, previewKey) => {
  try {
    const response = await apiFetch(
      apiBaseUrl,
      apiKey,
      `/api/v2/stores/${storeHandle}/theme-previews/${previewKey}`,
    );

    const authError = checkAuthErrors(response);
    if (authError) return authError;

    if (response.status === 404) {
      return { ok: false, error: "Preview not found." };
    }

    if (!response.ok) {
      return {
        ok: false,
        error: `Server error: ${response.status} ${response.statusText}`,
      };
    }

    const preview = await response.json();
    return { ok: true, data: preview };
  } catch (error) {
    return {
      ok: false,
      error: `Could not fetch preview: ${formatNetworkError(error)}`,
    };
  }
};

/**
 * Download the storefront archive (zip) as a buffer.
 *
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @param {string} storeHandle
 * @returns {Promise<{ ok: true, data: Buffer } | { ok: false, error: string }>}
 */
export const downloadStorefrontArchive = async (
  apiBaseUrl,
  apiKey,
  storeHandle,
) => {
  try {
    const response = await apiFetch(
      apiBaseUrl,
      apiKey,
      `/api/admin/stores/${storeHandle}/code/download`,
    );

    const authError = checkAuthErrors(response);
    if (authError) return authError;

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Error del servidor: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    return { ok: true, data: Buffer.from(arrayBuffer) };
  } catch (error) {
    return {
      ok: false,
      error: `No se pudo descargar: ${formatNetworkError(error)}`,
    };
  }
};

/**
 * Download a preview's archive (zip) as a buffer.
 *
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @param {string} storeHandle
 * @param {string} previewKey
 * @returns {Promise<{ ok: true, data: Buffer } | { ok: false, error: string }>}
 */
export const downloadPreviewArchive = async (
  apiBaseUrl,
  apiKey,
  storeHandle,
  previewKey,
) => {
  try {
    const response = await apiFetch(
      apiBaseUrl,
      apiKey,
      `/api/admin/stores/${storeHandle}/theme-previews/${previewKey}/download`,
    );

    const authError = checkAuthErrors(response);
    if (authError) return authError;

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Server error: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    return { ok: true, data: Buffer.from(arrayBuffer) };
  } catch (error) {
    return {
      ok: false,
      error: `Could not download preview: ${formatNetworkError(error)}`,
    };
  }
};

/**
 * Upload a zip buffer to a preview, replacing its content.
 *
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @param {string} storeHandle
 * @param {string} previewKey
 * @param {Buffer} zipBuffer
 * @returns {Promise<{ ok: true } | { ok: false, error: string, retriable?: boolean }>}
 */
export const uploadPreviewZip = async (
  apiBaseUrl,
  apiKey,
  storeHandle,
  previewKey,
  zipBuffer,
  preserveInstances = false,
) => {
  try {
    const query = preserveInstances ? "?preserveInstances=true" : "";
    const response = await apiFetch(
      apiBaseUrl,
      apiKey,
      `/api/admin/stores/${storeHandle}/theme-previews/${previewKey}/upload${query}`,
      {
        method: "POST",
        body: zipBuffer,
        contentType: "application/zip",
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Error del servidor: ${response.status}${body ? ` — ${body}` : ""}`,
        retriable: isRetriableStatus(response.status),
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `No se pudo subir: ${formatNetworkError(error)}`,
      retriable: true,
    };
  }
};

/**
 * Upload a single file to a preview using multipart form data.
 * Works for both text and binary files.
 *
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @param {string} storeHandle
 * @param {string} previewKey
 * @param {string} relativePath
 * @param {Buffer} fileBuffer
 * @returns {Promise<{ ok: true } | { ok: false, error: string, retriable?: boolean }>}
 */
export const uploadPreviewFileMultipart = async (
  apiBaseUrl,
  apiKey,
  storeHandle,
  previewKey,
  relativePath,
  fileBuffer,
) => {
  try {
    const posixPath = relativePath.replaceAll("\\", "/");
    const lastSlashIndex = posixPath.lastIndexOf("/");
    const directory =
      lastSlashIndex === -1 ? "" : posixPath.slice(0, lastSlashIndex);
    const fileName =
      lastSlashIndex === -1 ? posixPath : posixPath.slice(lastSlashIndex + 1);

    const formData = new FormData();
    formData.set("directory", directory);
    formData.append("files", new File([new Uint8Array(fileBuffer)], fileName));

    const response = await fetch(
      `${apiBaseUrl}/api/admin/stores/${storeHandle}/theme-previews/${previewKey}/upload`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Error subiendo ${relativePath}: ${response.status}${body ? ` — ${body}` : ""}`,
        retriable: isRetriableStatus(response.status),
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `Error subiendo ${relativePath}: ${formatNetworkError(error)}`,
      retriable: true,
    };
  }
};

/**
 * Delete a file from a preview.
 *
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @param {string} storeHandle
 * @param {string} previewKey
 * @param {string} filePath
 * @returns {Promise<{ ok: true } | { ok: false, error: string, retriable?: boolean }>}
 */
export const deletePreviewFile = async (
  apiBaseUrl,
  apiKey,
  storeHandle,
  previewKey,
  filePath,
) => {
  try {
    const query = new URLSearchParams({ path: filePath }).toString();
    const response = await apiFetch(
      apiBaseUrl,
      apiKey,
      `/api/v2/stores/${storeHandle}/theme-previews/${previewKey}/file?${query}`,
      {
        method: "DELETE",
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Error eliminando ${filePath}: ${response.status}${body ? ` — ${body}` : ""}`,
        retriable: isRetriableStatus(response.status),
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `Error eliminando ${filePath}: ${formatNetworkError(error)}`,
      retriable: true,
    };
  }
};

/**
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @param {string} storeHandle
 * @param {string} [name]
 * @returns {Promise<{ ok: true, data: any } | { ok: false, error: string }>}
 */
export const createPreview = async (apiBaseUrl, apiKey, storeHandle, name) => {
  try {
    const response = await apiFetch(
      apiBaseUrl,
      apiKey,
      `/api/v2/stores/${storeHandle}/theme-previews`,
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
    return {
      ok: false,
      error: `Could not create preview: ${formatNetworkError(error)}`,
    };
  }
};

/**
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @param {string} storeHandle
 * @returns {Promise<{ ok: true, data: any[] } | { ok: false, error: string }>}
 */
export const listPreviews = async (apiBaseUrl, apiKey, storeHandle) => {
  try {
    const response = await apiFetch(
      apiBaseUrl,
      apiKey,
      `/api/v2/stores/${storeHandle}/theme-previews`,
    );
    if (!response.ok) {
      return { ok: false, error: `Server error: ${response.status}` };
    }
    const body = await response.json();
    return { ok: true, data: body?.previews ?? [] };
  } catch (error) {
    return {
      ok: false,
      error: `Could not list previews: ${formatNetworkError(error)}`,
    };
  }
};

/**
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @param {string} storeHandle
 * @param {string} previewKey
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export const deletePreview = async (
  apiBaseUrl,
  apiKey,
  storeHandle,
  previewKey,
) => {
  try {
    const response = await apiFetch(
      apiBaseUrl,
      apiKey,
      `/api/v2/stores/${storeHandle}/theme-previews/${previewKey}`,
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
    return {
      ok: false,
      error: `Could not delete preview: ${formatNetworkError(error)}`,
    };
  }
};

/**
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @param {string} storeHandle
 * @param {string} previewKey
 * @param {boolean} [overrideState]
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export const publishPreview = async (
  apiBaseUrl,
  apiKey,
  storeHandle,
  previewKey,
  overrideState = false,
) => {
  try {
    const response = await apiFetch(
      apiBaseUrl,
      apiKey,
      `/api/v2/stores/${storeHandle}/theme-previews/${previewKey}/publish`,
      {
        method: "POST",
        body: JSON.stringify({ overrideState }),
      },
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
    return {
      ok: false,
      error: `Could not publish preview: ${formatNetworkError(error)}`,
    };
  }
};

