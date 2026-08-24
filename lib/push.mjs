import { getProjectDir, loadConfigOrFail } from "./config.mjs";
import { uploadPreviewZip } from "./api.mjs";
import { createZipFromDirectory } from "./zip.mjs";
import { isInstanceFile } from "./theme-state.mjs";
import { loadTienduIgnore } from "./tienduignore.mjs";
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
  storeHandle,
  previewKey,
  rootDir,
  spinner,
  compressMessage = "Compressing files...",
  uploadMessage,
  retryMessage,
  overrideState = false,
}) => {
  spinner.message(compressMessage);

  const ignore = await loadTienduIgnore(rootDir);
  const shouldInclude = (relativePath) => {
    if (ignore.ignores(relativePath)) return false;
    if (!overrideState && isInstanceFile(relativePath)) return false;
    return true;
  };

  const zipBuffer = await createZipFromDirectory(
    rootDir,
    shouldInclude,
    ignore.ignores,
  );
  spinner.message(
    uploadMessage ?? `Uploading to preview ${previewKey} (${formatBytes(zipBuffer.length)})...`,
  );

  return retryAsync(
    () =>
      uploadPreviewZip(
        apiBaseUrl,
        apiKey,
        storeHandle,
        previewKey,
        zipBuffer,
        !overrideState,
      ),
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

export const push = async ({ previewKey: previewKeyArg, overrideState = false } = {}) => {
  const { config, credentials } = await loadConfigOrFail();

  const previewKey = previewKeyArg ?? await resolvePreviewKeyInteractively({ config, credentials });
  const previewDetails = await fetchPreviewDetails(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeHandle,
    previewKey,
  );

  if (!previewDetails.ok) {
    ui.log.error(`Preview ${previewKey} not found.`);
    process.exit(1);
  }

  const rootDir = getProjectDir();
  const spinner = ui.spinner();
  spinner.start("Compressing files...");

  const result = await pushPreparedDirectoryToPreview({
    apiBaseUrl: config.apiBaseUrl,
    apiKey: credentials.apiKey,
    storeHandle: config.storeHandle,
    previewKey,
    rootDir,
    spinner,
    overrideState,
  });

  if (!result.ok) {
    spinner.stop("Upload failed.", 1);
    ui.log.error(result.error);
    process.exit(1);
  }

  spinner.stop(`Files uploaded to preview ${previewKey}.`);
  ui.log.message(
    `Theme state: ${overrideState ? "overridden from local files" : "preserved from the theme editor"}`,
  );
  ui.log.message(`  ${previewDetails.data.url}`);
};
