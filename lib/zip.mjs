import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync, zipSync } from "fflate";
import { listFilesRecursive, toPosixPath } from "./fs-utils.mjs";

/**
 * @param {string} rootDir
 * @param {(relativePath: string) => boolean} [shouldInclude]
 * @param {(relativePath: string, isDirectory?: boolean) => boolean} [ignores]
 * @returns {Promise<Buffer>}
 */
export const createZipFromDirectory = async (
  rootDir,
  shouldInclude,
  ignores,
) => {
  const absoluteFiles = await listFilesRecursive(rootDir, { ignores });
  /** @type {Record<string, Uint8Array>} */
  const entries = {};

  for (const absolutePath of absoluteFiles) {
    const relativePath = toPosixPath(path.relative(rootDir, absolutePath));
    if (shouldInclude && !shouldInclude(relativePath)) continue;
    entries[relativePath] = new Uint8Array(await readFile(absolutePath));
  }

  return Buffer.from(zipSync(entries, { level: 6 }));
};

/**
 * @param {Buffer} zipBuffer
 * @returns {string[]}
 */
export const listZipEntryPaths = (zipBuffer) => {
  const archiveEntries = unzipSync(new Uint8Array(zipBuffer));
  return Object.keys(archiveEntries)
    .filter((relativePath) => relativePath && !relativePath.endsWith("/"))
    .map((relativePath) => toPosixPath(relativePath))
    .sort((left, right) => left.localeCompare(right));
};

/**
 * Extract a zip buffer into the given output directory.
 * Returns an array of extracted file paths (relative).
 *
 * @param {Buffer} zipBuffer
 * @param {string} outputDir
 * @param {(relativePath: string) => boolean} [shouldWrite]
 * @returns {Promise<string[]>}
 */
export const extractZip = async (zipBuffer, outputDir, shouldWrite) => {
  const archiveEntries = unzipSync(new Uint8Array(zipBuffer));
  const extractedFiles = [];
  const resolvedOutputDir = path.resolve(outputDir);

  for (const [relativePath, fileContent] of Object.entries(archiveEntries)) {
    if (!relativePath || relativePath.endsWith("/")) continue;

    const posixPath = toPosixPath(relativePath);
    if (shouldWrite && !shouldWrite(posixPath)) continue;

    const outputPath = path.join(outputDir, posixPath);
    const resolvedPath = path.resolve(outputPath);
    if (
      !resolvedPath.startsWith(`${resolvedOutputDir}${path.sep}`) &&
      resolvedPath !== resolvedOutputDir
    ) {
      continue;
    }

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, fileContent);
    extractedFiles.push(posixPath);
  }

  return extractedFiles.sort((left, right) => left.localeCompare(right));
};
