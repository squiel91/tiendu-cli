import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getProjectDir, loadConfigOrFail } from "./config.mjs";
import { downloadStorefrontArchive, downloadPreviewArchive } from "./api.mjs";
import { isInstanceFile } from "./theme-state.mjs";
import { loadTienduIgnore } from "./tienduignore.mjs";
import { listFilesRecursive, toPosixPath } from "./fs-utils.mjs";
import { fetchPreviewDetails } from "./preview.mjs";
import { extractZip, listZipEntryPaths } from "./zip.mjs";
import * as ui from "./ui.mjs";

/** @param {number} bytes */
const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const collectInstanceFiles = async (rootDir, ignores) => {
  const files = new Map();
  const absoluteFiles = await listFilesRecursive(rootDir, { ignores });

  for (const absolutePath of absoluteFiles) {
    const relativePath = toPosixPath(path.relative(rootDir, absolutePath));
    if (!isInstanceFile(relativePath)) continue;
    files.set(relativePath, await readFile(absolutePath));
  }

  return files;
};

const restoreInstanceFiles = async (rootDir, files) => {
  for (const [relativePath, content] of files) {
    const outputPath = path.join(rootDir, relativePath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content);
  }
};

const pruneEmptyDirectories = async (rootDir, ignores) => {
  const prune = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const absolutePath = path.join(dir, entry.name);
      const relativePath = toPosixPath(path.relative(rootDir, absolutePath));
      if (ignores(relativePath, true)) continue;
      await prune(absolutePath);
    }

    if (dir === rootDir) return;

    let remaining;
    try {
      remaining = await readdir(dir);
    } catch {
      return;
    }
    if (remaining.length === 0) {
      await rm(dir, { recursive: true, force: true });
    }
  };

  await prune(rootDir);
};

export const pull = async ({
  previewKey,
  forceLive = false,
  confirmOverwrite = true,
  overrideState = false,
} = {}) => {
  const { config, credentials } = await loadConfigOrFail();
  const rootDir = getProjectDir();
  const ignore = await loadTienduIgnore(rootDir);

  if (!previewKey && !forceLive && config.previewKey) {
    previewKey = config.previewKey;
  }

  if (forceLive) {
    previewKey = undefined;
  }

  const previewDetails = previewKey
    ? await fetchPreviewDetails(
        config.apiBaseUrl,
        credentials.apiKey,
        config.storeHandle,
        previewKey,
      )
    : null;

  const spinner = ui.spinner();
  const isPreviewPull = Boolean(previewKey);

  spinner.start(
    isPreviewPull
      ? `Downloading preview ${previewKey} from ${config.storeHandle}...`
      : `Downloading live theme from ${config.storeHandle}...`,
  );

  const result = isPreviewPull
    ? await downloadPreviewArchive(
        config.apiBaseUrl,
        credentials.apiKey,
        config.storeHandle,
        previewKey,
      )
    : await downloadStorefrontArchive(
        config.apiBaseUrl,
        credentials.apiKey,
        config.storeHandle,
      );

  if (!result.ok) {
    spinner.stop("Download failed.", 1);
    ui.log.error(result.error);
    process.exit(1);
  }

  spinner.stop(`Downloaded archive (${formatBytes(result.data.length)}).`);

  if (confirmOverwrite && ui.isInteractive()) {
    const confirmed = await ui.confirm({
      message:
        "Replace local theme files with the download? Files listed in tienduignore are kept.",
    });

    if (ui.isCancel(confirmed) || !confirmed) {
      ui.cancel("Pull cancelled.");
      return;
    }
  }

  spinner.start("Updating local files...");

  const preservedInstanceFiles = overrideState
    ? new Map()
    : await collectInstanceFiles(rootDir, ignore.ignores);

  const shouldWrite = (relativePath) => {
    if (ignore.ignores(relativePath)) return false;
    if (!overrideState && isInstanceFile(relativePath)) return false;
    return true;
  };

  const zipFiles = new Set(
    listZipEntryPaths(result.data).filter((relativePath) => shouldWrite(relativePath)),
  );
  const localFiles = await listFilesRecursive(rootDir, { ignores: ignore.ignores });

  for (const absolutePath of localFiles) {
    const relativePath = toPosixPath(path.relative(rootDir, absolutePath));
    if (zipFiles.has(relativePath)) continue;
    if (!overrideState && isInstanceFile(relativePath)) continue;
    await rm(absolutePath, { force: true });
  }

  const extractedFiles = await extractZip(result.data, rootDir, shouldWrite);

  if (!overrideState) {
    await restoreInstanceFiles(rootDir, preservedInstanceFiles);
  }

  await pruneEmptyDirectories(rootDir, ignore.ignores);

  const suffix = isPreviewPull ? ` from preview ${previewKey}` : "";
  spinner.stop(
    `${extractedFiles.length} file${extractedFiles.length === 1 ? "" : "s"} updated${suffix}.`,
  );
  ui.log.message(
    `Theme state: ${overrideState ? "overridden from downloaded files" : "preserved locally"}`,
  );

  if (previewDetails?.ok) {
    ui.log.message(`  ${previewDetails.data.url}`);
  }
};
