import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
import { loadConfigOrFail } from "./config.mjs";
import { uploadPreviewZip } from "./api.mjs";

const isDotfile = (name) => name.startsWith(".");

/**
 * Recursively list all files, skipping dotfiles/dotdirs.
 * @param {string} rootDir
 * @param {string} currentDir
 * @returns {Promise<string[]>}
 */
const listAllFiles = async (rootDir, currentDir) => {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (isDotfile(entry.name)) continue;

    const absolutePath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      const nested = await listAllFiles(rootDir, absolutePath);
      files.push(...nested);
    } else if (entry.isFile()) {
      files.push(absolutePath);
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

  for (const absoluteFilePath of absoluteFiles) {
    const relativePath = path
      .relative(rootDir, absoluteFilePath)
      .split(path.sep)
      .join("/");
    const fileBuffer = await readFile(absoluteFilePath);
    entries[relativePath] = new Uint8Array(fileBuffer);
  }

  return Buffer.from(zipSync(entries, { level: 6 }));
};

export const push = async () => {
  const { config, credentials } = await loadConfigOrFail();

  if (!config.previewKey) {
    console.error("No hay preview activo. Creá uno con: tiendu preview create");
    process.exit(1);
  }

  const rootDir = process.cwd();

  console.log("");
  console.log(`Subiendo archivos al preview ${config.previewKey}...`);

  const zipBuffer = await createZipFromDirectory(rootDir);
  console.log(`ZIP creado (${formatBytes(zipBuffer.length)})`);

  const result = await uploadPreviewZip(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
    config.previewKey,
    zipBuffer,
  );

  if (!result.ok) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  console.log("Archivos subidos al preview.");
  console.log("");
};

/** @param {number} bytes */
const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
