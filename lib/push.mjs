import { getDistDir, loadConfigOrFail } from "./config.mjs";
import { uploadPreviewZip } from "./api.mjs";
import { createZipFromDirectory } from "./archive.mjs";
import { build } from "./build.mjs";
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
}) => {
  spinner.message(compressMessage);

  const zipBuffer = await createZipFromDirectory(rootDir);
  spinner.message(
    uploadMessage ?? `Uploading to preview ${previewKey} (${formatBytes(zipBuffer.length)})...`,
  );

  return retryAsync(
    () => uploadPreviewZip(apiBaseUrl, apiKey, storeId, previewKey, zipBuffer),
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

export const push = async ({ skipBuild = false, previewKey: previewKeyArg } = {}) => {
  const { config, credentials } = await loadConfigOrFail();

  if (!skipBuild) {
    const result = await build();
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
  });

  if (!result.ok) {
    spinner.stop("Upload failed.", 1);
    ui.log.error(result.error);
    process.exit(1);
  }

  spinner.stop(`Files uploaded to preview ${previewKey}.`);
  ui.log.message(`  ${previewDetails.data.url}`);
};
