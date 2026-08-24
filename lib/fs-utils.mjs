import { readdir } from "node:fs/promises";
import path from "node:path";

export const toPosixPath = (relativePath) =>
  relativePath.split(path.sep).join("/");

/**
 * @param {string} absoluteDir
 * @param {{ rootDir?: string, ignores?: (relativePath: string, isDirectory?: boolean) => boolean }} [options]
 * @returns {Promise<string[]>}
 */
export const listFilesRecursive = async (absoluteDir, options = {}) => {
  const rootDir = options.rootDir ?? absoluteDir;
  const ignores = options.ignores ?? (() => false);
  let entries;
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(absoluteDir, entry.name);
    const relativePath = toPosixPath(path.relative(rootDir, absolutePath));

    if (entry.isDirectory()) {
      if (ignores(relativePath, true)) continue;
      files.push(...(await listFilesRecursive(absolutePath, { rootDir, ignores })));
      continue;
    }

    if (entry.isFile()) {
      if (ignores(relativePath, false)) continue;
      files.push(absolutePath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
};
