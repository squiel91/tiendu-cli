import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDistDir, loadConfigOrFail } from "./config.mjs";
import { downloadStorefrontArchive, downloadPreviewArchive } from "./api.mjs";
import { isInstanceFile } from "./build.mjs";
import { fetchPreviewDetails } from "./preview.mjs";
import { extractZip } from "./zip.mjs";
import * as ui from "./ui.mjs";

/** @param {number} bytes */
const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const collectInstanceFiles = async (rootDir, outputDirectoryName) => {
  const files = new Map();

  const collect = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await collect(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;

      const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join("/");
      const logicalPath = `${outputDirectoryName}/${relativePath}`;
      if (isInstanceFile(logicalPath)) {
        files.set(relativePath, await readFile(absolutePath));
      }
    }
  };

  await collect(rootDir);
  return files;
};

const restoreInstanceFiles = async (rootDir, files) => {
  for (const [relativePath, content] of files) {
    const outputPath = path.join(rootDir, relativePath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content);
  }
};

const deleteInstanceFiles = async (rootDir, outputDirectoryName) => {
  const remove = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await remove(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;

      const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join("/");
      const logicalPath = `${outputDirectoryName}/${relativePath}`;
      if (isInstanceFile(logicalPath)) {
        await rm(absolutePath, { force: true });
      }
    }
  };

  await remove(rootDir);
};

const syncDistToSrc = async (distDir, { overrideState = false } = {}) => {
  const rootDir = path.resolve(distDir, "..");
  const srcDir = path.join(rootDir, "src");
  let entries;

  try {
    entries = await readdir(distDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  const distDirs = entries.filter(
    (entry) => entry.isDirectory() && !entry.name.startsWith("."),
  );

  let synced = 0;

  for (const dir of distDirs) {
    const distSubDir = path.join(distDir, dir.name);
    const srcDest = path.join(srcDir, dir.name);
    const rootDest = path.join(rootDir, dir.name);
    const preservedInstanceFiles = overrideState
      ? new Map()
      : await collectInstanceFiles(srcDest, dir.name);
    const preservedRootInstanceFiles = overrideState || srcDest === rootDest
      ? new Map()
      : await collectInstanceFiles(rootDest, dir.name);

    await rm(srcDest, { recursive: true, force: true });

    if (srcDest !== rootDest) {
      await rm(rootDest, { recursive: true, force: true });
    }

    await cp(distSubDir, srcDest, { recursive: true });
    if (!overrideState) {
      await deleteInstanceFiles(srcDest, dir.name);
      await restoreInstanceFiles(srcDest, preservedInstanceFiles);
      if (srcDest !== rootDest) {
        await restoreInstanceFiles(rootDest, preservedRootInstanceFiles);
      }
    }
    synced++;
  }

  return synced;
};

export const pull = async ({ previewKey, forceLive = false, confirmSourceSync = true, overrideState = false } = {}) => {
  const { config, credentials } = await loadConfigOrFail();

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
        config.storeId,
        previewKey,
      )
    : null;

  const spinner = ui.spinner();
  const isPreviewPull = Boolean(previewKey);

  spinner.start(
    isPreviewPull
      ? `Downloading preview ${previewKey} from store #${config.storeId}...`
      : `Downloading live theme from store #${config.storeId}...`,
  );

  const result = isPreviewPull
    ? await downloadPreviewArchive(
        config.apiBaseUrl,
        credentials.apiKey,
        config.storeId,
        previewKey,
      )
    : await downloadStorefrontArchive(
        config.apiBaseUrl,
        credentials.apiKey,
        config.storeId,
      );

  if (!result.ok) {
    spinner.stop("Download failed.", 1);
    ui.log.error(result.error);
    process.exit(1);
  }

  spinner.message(`Extracting archive (${formatBytes(result.data.length)})...`);

  const outputDir = getDistDir();
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  const extractedFiles = await extractZip(result.data, outputDir);

  const suffix = isPreviewPull ? ` from preview ${previewKey}` : "";
  spinner.stop(
    `${extractedFiles.length} file${extractedFiles.length === 1 ? "" : "s"} extracted${suffix}.`,
  );

  if (confirmSourceSync && ui.isInteractive()) {
    const confirmed = await ui.confirm({
      message: "Sync downloaded theme directories to src/? This overwrites local theme files.",
    });

    if (ui.isCancel(confirmed) || !confirmed) {
      ui.cancel("Source sync cancelled. dist/ was updated.");
      return;
    }
  }

  spinner.start("Syncing dist to src...");
  const syncedDirs = await syncDistToSrc(outputDir, { overrideState });
  spinner.stop(
    `${syncedDirs} director${syncedDirs === 1 ? "y" : "ies"} synced to src/.`,
  );
  ui.log.message(
    `Theme state: ${overrideState ? "overridden from downloaded files" : "preserved locally"}`,
  );

  if (previewDetails?.ok) {
    ui.log.message(`  ${previewDetails.data.url}`);
  }
};
