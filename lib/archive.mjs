import { readFile } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
import { listFilesRecursive } from "./fs-utils.mjs";

/**
 * @param {string} rootDir
 * @returns {Promise<string[]>}
 */
export const listAllFiles = async (rootDir) => listFilesRecursive(rootDir);

/**
 * @param {string} rootDir
 * @returns {Promise<Buffer>}
 */
export const createZipFromDirectory = async (rootDir, shouldInclude) => {
  const absoluteFiles = await listAllFiles(rootDir);
  /** @type {Record<string, Uint8Array>} */
  const entries = {};

  for (const absolutePath of absoluteFiles) {
    const relativePath = path
      .relative(rootDir, absolutePath)
      .split(path.sep)
      .join("/");
    if (shouldInclude && !shouldInclude(relativePath)) continue;
    entries[relativePath] = new Uint8Array(await readFile(absolutePath));
  }

  return Buffer.from(zipSync(entries, { level: 6 }));
};
