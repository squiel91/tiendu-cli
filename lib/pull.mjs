import { mkdir, rm } from "node:fs/promises";
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

export const pull = async ({ previewKey } = {}) => {
  const { config, credentials } = await loadConfigOrFail();
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

  if (previewDetails?.ok) {
    ui.log.message(`  ${previewDetails.data.url}`);
  }
};
