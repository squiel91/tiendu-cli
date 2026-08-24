import { watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { getProjectDir, loadConfigOrFail } from "./config.mjs";
import {
  fetchPreviewDetails,
  getThemeEditorUrl,
  resolvePreviewKeyInteractively,
} from "./preview.mjs";
import {
  deletePreviewFile,
  uploadPreviewFileMultipart,
} from "./api.mjs";
import { isInstanceFile } from "./theme-state.mjs";
import { loadTienduIgnore } from "./tienduignore.mjs";
import { toPosixPath } from "./fs-utils.mjs";
import { pushPreparedDirectoryToPreview } from "./push.mjs";
import { retryAsync } from "./retry.mjs";
import * as ui from "./ui.mjs";

const RETRY_ATTEMPTS = 3;
const MAX_SYNC_FILE_SIZE_BYTES = 20 * 1024 * 1024;

const shouldIgnoreEditorJunk = (relativePath) => {
  const basename = relativePath.split("/").at(-1) ?? "";
  return basename.endsWith("~") || /\.(swp|tmp|temp)$/i.test(basename);
};

const shouldRetrySyncResult = (result) =>
  !result.ok && Boolean(result.retriable);

const uploadFileWithRetries = (
  apiBaseUrl,
  apiKey,
  storeHandle,
  previewKey,
  relativePath,
  content,
  onRetry,
) =>
  retryAsync(
    () =>
      uploadPreviewFileMultipart(
        apiBaseUrl,
        apiKey,
        storeHandle,
        previewKey,
        relativePath,
        content,
      ),
    {
      attempts: RETRY_ATTEMPTS,
      shouldRetry: shouldRetrySyncResult,
      onRetry,
    },
  );

const deleteFileWithRetries = (
  apiBaseUrl,
  apiKey,
  storeHandle,
  previewKey,
  relativePath,
  onRetry,
) =>
  retryAsync(
    () =>
      deletePreviewFile(
        apiBaseUrl,
        apiKey,
        storeHandle,
        previewKey,
        relativePath,
      ),
    {
      attempts: RETRY_ATTEMPTS,
      shouldRetry: shouldRetrySyncResult,
      onRetry,
    },
  );

export const dev = async ({ overrideState = false } = {}) => {
  const { config, credentials } = await loadConfigOrFail();
  const { apiBaseUrl, storeHandle } = config;
  const { apiKey } = credentials;
  const rootDir = getProjectDir();
  const ignore = await loadTienduIgnore(rootDir);

  const previewKey = await resolvePreviewKeyInteractively({ config, credentials });

  const previewResult = await fetchPreviewDetails(
    apiBaseUrl,
    apiKey,
    storeHandle,
    previewKey,
  );
  if (!previewResult.ok) {
    ui.log.error(`Preview ${previewKey} not found.`);
    process.exit(1);
  }

  const previewUrl = previewResult.data.url;

  const spinner = ui.spinner();
  spinner.start("Compressing files...");

  const uploadResult = await pushPreparedDirectoryToPreview({
    apiBaseUrl,
    apiKey,
    storeHandle,
    previewKey,
    rootDir,
    spinner,
    compressMessage: "Compressing files...",
    retryMessage: (result, nextAttempt) =>
      `Initial push failed. Retrying ${nextAttempt}/${RETRY_ATTEMPTS}... ${result.error}`,
    overrideState,
  });

  if (!uploadResult.ok) {
    spinner.stop("Initial push failed.", 1);
    ui.log.error(uploadResult.error);
    process.exit(1);
  }

  spinner.stop(`Preview ready (${previewKey}).`);
  ui.log.message(`Sharable preview: ${previewUrl}`);
  ui.log.message(`Theme editor: ${getThemeEditorUrl(apiBaseUrl, storeHandle, previewKey)}`);
  ui.log.message(
    `Theme state: ${overrideState ? "overridden from local files" : "preserved from the theme editor"}`,
  );

  ui.log.message("Watching for changes - press Ctrl+C to stop.");

  /** @type {Map<string, NodeJS.Timeout>} */
  const debounceMap = new Map();
  const inFlightPaths = new Set();
  const pendingResyncPaths = new Set();
  const DEBOUNCE_MS = 300;

  const queueSync = (relativePath) => {
    const existingTimer = debounceMap.get(relativePath);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      debounceMap.delete(relativePath);
      void syncPath(relativePath);
    }, DEBOUNCE_MS);

    debounceMap.set(relativePath, timer);
  };

  const syncPath = async (relativePath) => {
    if (inFlightPaths.has(relativePath)) {
      pendingResyncPaths.add(relativePath);
      return;
    }

    inFlightPaths.add(relativePath);

    try {
      const absolutePath = path.join(rootDir, relativePath);
      const fileStat = await stat(absolutePath).catch(() => null);

      if (!fileStat || !fileStat.isFile()) {
        if (!fileStat) {
          console.log(`DELETE ${relativePath}`);
          const result = await deleteFileWithRetries(
            apiBaseUrl,
            apiKey,
            storeHandle,
            previewKey,
            relativePath,
            async (_, nextAttempt) => {
              ui.log.warn(
                `     Retry delete ${relativePath} (${nextAttempt}/${RETRY_ATTEMPTS})`,
              );
            },
          );

          if (!result.ok) {
            ui.log.warn(`     Failed to delete after ${RETRY_ATTEMPTS} attempts: ${result.error}`);
          }
        }

        return;
      }

      console.log(`UPLOAD ${relativePath}`);
      if (fileStat.size > MAX_SYNC_FILE_SIZE_BYTES) {
        ui.log.warn(
          `     Skipping ${relativePath}: file is ${(fileStat.size / (1024 * 1024)).toFixed(1)} MB (limit ${(MAX_SYNC_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0)} MB).`,
        );
        return;
      }

      const content = await readFile(absolutePath);
      const result = await uploadFileWithRetries(
        apiBaseUrl,
        apiKey,
        storeHandle,
        previewKey,
        relativePath,
        content,
        async (_, nextAttempt) => {
          ui.log.warn(
            `     Retry upload ${relativePath} (${nextAttempt}/${RETRY_ATTEMPTS})`,
          );
        },
      );

      if (!result.ok) {
        ui.log.warn(`     Failed to upload after ${RETRY_ATTEMPTS} attempts: ${result.error}`);
      }
    } catch (error) {
      ui.log.warn(`     Error processing ${relativePath}: ${error.message}`);
    } finally {
      inFlightPaths.delete(relativePath);

      if (pendingResyncPaths.delete(relativePath)) {
        queueSync(relativePath);
      }
    }
  };

  const watcher = watch(rootDir, { recursive: true }, (_eventType, filename) => {
    if (!filename) return;

    const relativePath = toPosixPath(filename);
    if (ignore.ignores(relativePath) || shouldIgnoreEditorJunk(relativePath)) return;
    if (!overrideState && isInstanceFile(relativePath)) return;
    queueSync(relativePath);
  });

  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;

    watcher.close();
    for (const timer of debounceMap.values()) clearTimeout(timer);

    ui.outro("Dev mode stopped.");
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  await new Promise(() => {});
};
