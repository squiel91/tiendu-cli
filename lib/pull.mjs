import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { getDistDir, loadConfigOrFail } from "./config.mjs";
import { downloadStorefrontArchive, downloadPreviewArchive } from "./api.mjs";
import { fetchPreviewDetails } from "./preview.mjs";
import { extractZip } from "./zip.mjs";
import * as ui from "./ui.mjs";

/** @param {number} bytes */
const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const syncDistToSrc = async (distDir) => {
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

    await rm(srcDest, { recursive: true, force: true });

    if (srcDest !== rootDest) {
      await rm(rootDest, { recursive: true, force: true });
    }

    await cp(distSubDir, srcDest, { recursive: true });
    synced++;
  }

  return synced;
};

export const pull = async ({ previewKey, forceLive = false, confirmSourceSync = true } = {}) => {
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
  const syncedDirs = await syncDistToSrc(outputDir);
  spinner.stop(
    `${syncedDirs} director${syncedDirs === 1 ? "y" : "ies"} synced to src/.`,
  );

  if (previewDetails?.ok) {
    ui.log.message(`  ${previewDetails.data.url}`);
  }
};
