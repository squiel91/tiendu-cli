import { getDistDir, loadConfigOrFail } from "./config.mjs";
import { uploadPreviewZip } from "./api.mjs";
import { createZipFromDirectory } from "./archive.mjs";
import { build, isInstanceFile } from "./build.mjs";
import {
  fetchPreviewDetails,
  resolvePreviewKeyInteractively,
} from "./preview.mjs";
import { retryAsync } from "./retry.mjs";
import * as ui from "./ui.mjs";

/** @param {number} bytes */
const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const pushPreparedDirectoryToPreview = async ({
  apiBaseUrl,
  apiKey,
  storeId,
  previewKey,
  rootDir,
  spinner,
  compressMessage = "Compressing files...",
  uploadMessage,
  retryMessage,
  includeInstances = false,
}) => {
  spinner.message(compressMessage);

  const shouldInclude = !includeInstances
    ? (relativePath) => !isInstanceFile(relativePath)
    : undefined;

  const zipBuffer = await createZipFromDirectory(rootDir, shouldInclude);
  spinner.message(
    uploadMessage ?? `Uploading to preview ${previewKey} (${formatBytes(zipBuffer.length)})...`,
  );

  return retryAsync(
    () => uploadPreviewZip(apiBaseUrl, apiKey, storeId, previewKey, zipBuffer, !includeInstances),
    {
      attempts: 3,
      shouldRetry: (uploadResult) => !uploadResult.ok && Boolean(uploadResult.retriable),
      onRetry: async (uploadResult, nextAttempt) => {
        spinner.message(
          retryMessage?.(uploadResult, nextAttempt) ??
            `Upload failed. Retrying ${nextAttempt}/3... ${uploadResult.error}`,
        );
      },
    },
  );
};

export const push = async ({ skipBuild = false, previewKey: previewKeyArg, includeInstances = false } = {}) => {
  const { config, credentials } = await loadConfigOrFail();

  if (!skipBuild) {
    const result = await build({ includeInstances });
    if (!result.ok) {
      process.exit(1);
    }
  }

  // Resolve preview key: explicit arg > interactive picker
  const previewKey = previewKeyArg ?? await resolvePreviewKeyInteractively({ config, credentials });
  const previewDetails = await fetchPreviewDetails(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
    previewKey,
  );

  if (!previewDetails.ok) {
    ui.log.error(`Preview ${previewKey} not found.`);
    process.exit(1);
  }

  const rootDir = getDistDir();
  const spinner = ui.spinner();
  spinner.start("Compressing files...");

  const result = await pushPreparedDirectoryToPreview({
    apiBaseUrl: config.apiBaseUrl,
    apiKey: credentials.apiKey,
    storeId: config.storeId,
    previewKey,
    rootDir,
    spinner,
    includeInstances,
  });

  if (!result.ok) {
    spinner.stop("Upload failed.", 1);
    ui.log.error(result.error);
    process.exit(1);
  }

  spinner.stop(`Files uploaded to preview ${previewKey}.`);
  ui.log.message(
    `Theme state: ${includeInstances ? "overridden from local files" : "preserved from the theme editor"}`,
  );
  ui.log.message(`  ${previewDetails.data.url}`);
};
