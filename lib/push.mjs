import * as p from "@clack/prompts";
import { loadConfigOrFail, isBuiltTheme, getDistDir } from "./config.mjs";
import { uploadPreviewZip } from "./api.mjs";
import { createZipFromDirectory } from "./archive.mjs";
import { build } from "./build.mjs";
import { retryAsync } from "./retry.mjs";

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
  packMessage = "Packing files...",
  uploadMessage,
  retryMessage,
}) => {
  spinner.message(packMessage);

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

export const push = async ({ skipBuild = false } = {}) => {
  const { config, credentials } = await loadConfigOrFail();

  if (!config.previewKey) {
    p.log.error("No active preview. Create one with: tiendu preview create");
    process.exit(1);
  }

  const builtTheme = await isBuiltTheme();

  if (builtTheme && !skipBuild) {
    const result = await build();
    if (!result.ok) {
      process.exit(1);
    }
  }

  const rootDir = builtTheme ? getDistDir() : process.cwd();
  const spinner = p.spinner();
  spinner.start("Packing files...");

  const result = await pushPreparedDirectoryToPreview({
    apiBaseUrl: config.apiBaseUrl,
    apiKey: credentials.apiKey,
    storeId: config.storeId,
    previewKey: config.previewKey,
    rootDir,
    spinner,
  });

  if (!result.ok) {
    spinner.stop("Upload failed.", 1);
    p.log.error(result.error);
    process.exit(1);
  }

  spinner.stop("Files uploaded to preview.");
};
