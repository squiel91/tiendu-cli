import { watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { loadConfigOrFail, writeConfig } from "./config.mjs";
import { createPreview, listPreviews } from "./preview.mjs";
import {
  uploadPreviewFileMultipart,
  deletePreviewFile,
  uploadPreviewZip,
} from "./api.mjs";
import { readdir } from "node:fs/promises";
import { zipSync } from "fflate";

const isDotfile = (name) => name.startsWith(".");
const buildPreviewUrl = (apiBaseUrl, previewHostname) => {
  const base = new URL(apiBaseUrl);
  const hasExplicitPort = previewHostname.includes(":");
  return `${base.protocol}//${previewHostname}${!hasExplicitPort && base.port ? `:${base.port}` : ""}/`;
};

/**
 * Check if a relative path contains any dotfile segments.
 * @param {string} relativePath
 * @returns {boolean}
 */
const hasDotfileSegment = (relativePath) => {
  const segments = relativePath.split(path.sep);
  return segments.some((s) => isDotfile(s));
};

/**
 * Recursively list all files, skipping dotfiles.
 * @param {string} rootDir
 * @param {string} currentDir
 * @returns {Promise<string[]>}
 */
const listAllFiles = async (rootDir, currentDir) => {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (isDotfile(entry.name)) continue;
    const abs = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listAllFiles(rootDir, abs);
      files.push(...nested);
    } else if (entry.isFile()) {
      files.push(abs);
    }
  }
  return files;
};

/**
 * Create a zip buffer from the current directory, skipping dotfiles.
 * @param {string} rootDir
 * @returns {Promise<Buffer>}
 */
const createZipFromDirectory = async (rootDir) => {
  const absoluteFiles = await listAllFiles(rootDir, rootDir);
  /** @type {Record<string, Uint8Array>} */
  const entries = {};
  for (const abs of absoluteFiles) {
    const rel = path.relative(rootDir, abs).split(path.sep).join("/");
    const buf = await readFile(abs);
    entries[rel] = new Uint8Array(buf);
  }
  return Buffer.from(zipSync(entries, { level: 6 }));
};

export const dev = async () => {
  const { config, credentials } = await loadConfigOrFail();
  const { apiBaseUrl, storeId } = config;
  const { apiKey } = credentials;
  const rootDir = process.cwd();

  let previewKey = config.previewKey;

  // Ensure a preview exists
  if (!previewKey) {
    console.log("");
    console.log("No hay preview activo. Creando uno...");

    const result = await createPreview(apiBaseUrl, apiKey, storeId, "Dev");
    if (!result.ok) {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }

    previewKey = result.data.previewKey;
    await writeConfig({ ...config, previewKey });

    console.log(`Preview creado: ${previewKey}`);
    console.log(
      `URL: ${buildPreviewUrl(apiBaseUrl, result.data.previewHostname)}`,
    );

    // Initial push of all files
    console.log("Subiendo archivos iniciales...");
    const zipBuffer = await createZipFromDirectory(rootDir);
    const uploadResult = await uploadPreviewZip(
      apiBaseUrl,
      apiKey,
      storeId,
      previewKey,
      zipBuffer,
    );
    if (!uploadResult.ok) {
      console.error(`Error subiendo archivos: ${uploadResult.error}`);
      process.exit(1);
    }
    console.log("Archivos subidos.");
  } else {
    // Verify the preview still exists
    const listResult = await listPreviews(apiBaseUrl, apiKey, storeId);
    if (!listResult.ok) {
      console.error(`Error: ${listResult.error}`);
      process.exit(1);
    }
    const existing = listResult.data.find((p) => p.previewKey === previewKey);
    if (!existing) {
      console.error(
        `El preview ${previewKey} ya no existe. Eliminá la config con: tiendu preview delete`,
      );
      process.exit(1);
    }
    console.log("");
    console.log(`Preview activo: ${previewKey}`);
    console.log(
      `URL: ${buildPreviewUrl(apiBaseUrl, existing.previewHostname)}`,
    );
  }

  console.log("");
  console.log("Observando cambios... (Ctrl+C para salir)");
  console.log("");

  // Debounce map: relativePath -> timeout
  /** @type {Map<string, NodeJS.Timeout>} */
  const debounceMap = new Map();
  const DEBOUNCE_MS = 300;

  const watcher = watch(rootDir, { recursive: true }, (eventType, filename) => {
    if (!filename) return;

    // Skip dotfiles
    if (hasDotfileSegment(filename)) return;

    // Normalize to posix path
    const relativePath = filename.split(path.sep).join("/");

    // Clear existing debounce timer
    const existing = debounceMap.get(relativePath);
    if (existing) clearTimeout(existing);

    // Set new debounce timer
    const timer = setTimeout(async () => {
      debounceMap.delete(relativePath);

      const absolutePath = path.join(rootDir, filename);

      try {
        const fileStat = await stat(absolutePath).catch(() => null);

        if (!fileStat || !fileStat.isFile()) {
          // File was deleted or is a directory
          if (!fileStat) {
            console.log(`  ✕ ${relativePath}`);
            const result = await deletePreviewFile(
              apiBaseUrl,
              apiKey,
              storeId,
              previewKey,
              relativePath,
            );
            if (!result.ok) {
              console.error(`    Error: ${result.error}`);
            }
          }
          return;
        }

        // File was created or modified
        const content = await readFile(absolutePath);
        console.log(`  ↑ ${relativePath}`);

        const result = await uploadPreviewFileMultipart(
          apiBaseUrl,
          apiKey,
          storeId,
          previewKey,
          relativePath,
          content,
        );

        if (!result.ok) {
          console.error(`    Error: ${result.error}`);
        }
      } catch (error) {
        console.error(`  Error procesando ${relativePath}: ${error.message}`);
      }
    }, DEBOUNCE_MS);

    debounceMap.set(relativePath, timer);
  });

  // Handle graceful shutdown
  const cleanup = () => {
    watcher.close();
    for (const timer of debounceMap.values()) {
      clearTimeout(timer);
    }
    console.log("");
    console.log("Dev mode finalizado.");
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Keep process alive
  await new Promise(() => {});
};
