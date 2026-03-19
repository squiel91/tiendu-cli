import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";

/**
 * Extract a zip buffer into the given output directory.
 * Returns an array of extracted file paths (relative).
 *
 * @param {Buffer} zipBuffer
 * @param {string} outputDir
 * @returns {Promise<string[]>}
 */
export const extractZip = async (zipBuffer, outputDir) => {
  const archiveEntries = unzipSync(new Uint8Array(zipBuffer));
  const extractedFiles = [];
  const resolvedOutputDir = path.resolve(outputDir);

  for (const [relativePath, fileContent] of Object.entries(archiveEntries)) {
    if (!relativePath || relativePath.endsWith("/")) continue;

    const outputPath = path.join(outputDir, relativePath);
    const resolvedPath = path.resolve(outputPath);
    if (
      !resolvedPath.startsWith(`${resolvedOutputDir}${path.sep}`) &&
      resolvedPath !== resolvedOutputDir
    ) {
      continue;
    }

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, fileContent);
    extractedFiles.push(relativePath);
  }

  return extractedFiles.sort((left, right) => left.localeCompare(right));
};
