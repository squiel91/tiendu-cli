import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";

const isDotfile = (name) => name.startsWith(".");

/**
 * @param {string} rootDir
 * @param {string} currentDir
 * @returns {Promise<string[]>}
 */
export const listAllFiles = async (rootDir, currentDir = rootDir) => {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (isDotfile(entry.name)) continue;

    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listAllFiles(rootDir, absolutePath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
};

/**
 * @param {string} rootDir
 * @returns {Promise<Buffer>}
 */
export const createZipFromDirectory = async (rootDir) => {
  const absoluteFiles = await listAllFiles(rootDir);
  /** @type {Record<string, Uint8Array>} */
  const entries = {};

  for (const absolutePath of absoluteFiles) {
    const relativePath = path
      .relative(rootDir, absolutePath)
      .split(path.sep)
      .join("/");
    entries[relativePath] = new Uint8Array(await readFile(absolutePath));
  }

  return Buffer.from(zipSync(entries, { level: 6 }));
};
