/**
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @param {string} path
 * @param {{ method?: string, body?: string | Buffer | Uint8Array, contentType?: string }} [options]
 * @returns {Promise<Response>}
 */
export const apiFetch = (apiBaseUrl, apiKey, path, options = {}) => {
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
 * Validate API key and store access with a HEAD request to the download endpoint.
 *
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @param {number} storeId
 * @returns {Promise<{ ok: true, data: { name: string } } | { ok: false, error: string }>}
 */
export const fetchStoreInfo = async (apiBaseUrl, apiKey, storeId) => {
  try {
    const response = await apiFetch(
      apiBaseUrl,
      apiKey,
      `/api/admin/stores/${storeId}/code/download`,
      { method: "HEAD" },
    );

    const authError = checkAuthErrors(response);
    if (authError) return authError;

    if (!response.ok) {
      return {
        ok: false,
        error: `Error del servidor: ${response.status} ${response.statusText}`,
      };
    }

    return { ok: true, data: { name: `Tienda #${storeId}` } };
  } catch (error) {
    return {
      ok: false,
      error: `No se pudo conectar a ${apiBaseUrl}: ${error.message}`,
    };
  }
};

/**
 * Download the storefront archive (zip) as a buffer.
 *
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @param {number} storeId
 * @returns {Promise<{ ok: true, data: Buffer } | { ok: false, error: string }>}
 */
export const downloadStorefrontArchive = async (
  apiBaseUrl,
  apiKey,
  storeId,
) => {
  try {
    const response = await apiFetch(
      apiBaseUrl,
      apiKey,
      `/api/admin/stores/${storeId}/code/download`,
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
      error: `No se pudo descargar: ${error.message}`,
    };
  }
};

/**
 * Upload a zip buffer to a preview, replacing its content.
 *
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @param {number} storeId
 * @param {string} previewKey
 * @param {Buffer} zipBuffer
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export const uploadPreviewZip = async (
  apiBaseUrl,
  apiKey,
  storeId,
  previewKey,
  zipBuffer,
) => {
  try {
    const response = await apiFetch(
      apiBaseUrl,
      apiKey,
      `/api/admin/stores/${storeId}/theme-previews/${previewKey}/upload`,
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
      };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: `No se pudo subir: ${error.message}` };
  }
};

/**
 * Upload a single file to a preview.
 *
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @param {number} storeId
 * @param {string} previewKey
 * @param {string} filePath - relative path within the preview
 * @param {string} content - file content
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export const uploadPreviewFile = async (
  apiBaseUrl,
  apiKey,
  storeId,
  previewKey,
  filePath,
  content,
) => {
  try {
    const query = new URLSearchParams({ path: filePath }).toString();
    const response = await apiFetch(
      apiBaseUrl,
      apiKey,
      `/api/v2/stores/${storeId}/theme-previews/${previewKey}/file?${query}`,
      {
        method: "PUT",
        body: JSON.stringify({ content }),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Error subiendo ${filePath}: ${response.status}${body ? ` — ${body}` : ""}`,
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `Error subiendo ${filePath}: ${error.message}`,
    };
  }
};

/**
 * Upload a single file to a preview using multipart form data.
 * Works for both text and binary files.
 *
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @param {number} storeId
 * @param {string} previewKey
 * @param {string} relativePath
 * @param {Buffer} fileBuffer
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export const uploadPreviewFileMultipart = async (
  apiBaseUrl,
  apiKey,
  storeId,
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
      `${apiBaseUrl}/api/admin/stores/${storeId}/theme-previews/${previewKey}/upload`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Error subiendo ${relativePath}: ${response.status}${body ? ` — ${body}` : ""}`,
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `Error subiendo ${relativePath}: ${error.message}`,
    };
  }
};

/**
 * Delete a file from a preview.
 *
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @param {number} storeId
 * @param {string} previewKey
 * @param {string} filePath
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export const deletePreviewFile = async (
  apiBaseUrl,
  apiKey,
  storeId,
  previewKey,
  filePath,
) => {
  try {
    const query = new URLSearchParams({ path: filePath }).toString();
    const response = await apiFetch(
      apiBaseUrl,
      apiKey,
      `/api/v2/stores/${storeId}/theme-previews/${previewKey}/file?${query}`,
      {
        method: "DELETE",
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Error eliminando ${filePath}: ${response.status}${body ? ` — ${body}` : ""}`,
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `Error eliminando ${filePath}: ${error.message}`,
    };
  }
};
