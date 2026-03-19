import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import * as p from "@clack/prompts";
import { zipSync } from "fflate";
import { loadConfigOrFail } from "./config.mjs";
import { uploadPreviewZip } from "./api.mjs";

/** @param {number} bytes */
const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

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
    const abs = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listAllFiles(rootDir, abs)));
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
    entries[rel] = new Uint8Array(await readFile(abs));
  }
  return Buffer.from(zipSync(entries, { level: 6 }));
};

export const push = async () => {
  const { config, credentials } = await loadConfigOrFail();

  if (!config.previewKey) {
    p.log.error("No active preview. Create one with: tiendu preview create");
    process.exit(1);
  }

  const rootDir = process.cwd();
  const spinner = p.spinner();
  spinner.start("Packing files...");

  const zipBuffer = await createZipFromDirectory(rootDir);
  spinner.message(
    `Uploading to preview ${config.previewKey} (${formatBytes(zipBuffer.length)})...`,
  );

  const result = await uploadPreviewZip(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
    config.previewKey,
    zipBuffer,
  );

  if (!result.ok) {
    spinner.stop("Upload failed.", 1);
    p.log.error(result.error);
    process.exit(1);
  }

  spinner.stop("Files uploaded to preview.");
};
