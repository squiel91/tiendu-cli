import { access, readdir } from "node:fs/promises";
import path from "node:path";

export const isDotfile = (name) => name.startsWith(".");

export const fileExists = async (filePath) => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

export const listFilesRecursive = async (absoluteDir) => {
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (isDotfile(entry.name)) continue;

    const absolutePath = path.join(absoluteDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(absolutePath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
};
