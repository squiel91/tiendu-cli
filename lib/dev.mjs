import { watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { getDistDir, loadConfigOrFail } from "./config.mjs";
import {
  fetchPreviewDetails,
  resolvePreviewKeyInteractively,
} from "./preview.mjs";
import {
  deletePreviewFile,
  uploadPreviewFileMultipart,
} from "./api.mjs";
import { build } from "./build.mjs";
import { isDotfile } from "./fs-utils.mjs";
import { startLocalPreviewServer } from "./local-preview.mjs";
import { pushPreparedDirectoryToPreview } from "./push.mjs";
import { retryAsync } from "./retry.mjs";
import * as ui from "./ui.mjs";

const RETRY_ATTEMPTS = 3;
const MAX_SYNC_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const CLEANUP_TIMEOUT_MS = 5_000;
const IGNORED_ROOT_SEGMENTS = new Set(["node_modules", ".git"]);

const hasDotfileSegment = (relativePath) =>
  relativePath.split(path.sep).some(isDotfile);

const shouldIgnoreWatchedPath = (relativePath, builtTheme) => {
  const normalizedPath = relativePath.split(path.sep).join("/");
  const segments = normalizedPath.split("/");
  const basename = segments.at(-1) ?? "";

  if (segments.some((segment) => IGNORED_ROOT_SEGMENTS.has(segment))) {
    return true;
  }

  if (!builtTheme && segments[0] === "dist") {
    return true;
  }

  return basename.endsWith("~") || /\.(swp|tmp|temp)$/i.test(basename);
};

const shouldRetrySyncResult = (result) =>
  !result.ok && Boolean(result.retriable);

const runCleanupStep = async (label, cleanupFn) => {
  if (!cleanupFn) return;

  let timeoutId = null;

  try {
    await Promise.race([
      Promise.resolve().then(() => cleanupFn()),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} did not finish within ${CLEANUP_TIMEOUT_MS}ms.`));
        }, CLEANUP_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    ui.log.warn(error.message);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const uploadFileWithRetries = (
  apiBaseUrl,
  apiKey,
  storeId,
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
        storeId,
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
  storeId,
  previewKey,
  relativePath,
  onRetry,
) =>
  retryAsync(
    () =>
      deletePreviewFile(
        apiBaseUrl,
        apiKey,
        storeId,
        previewKey,
        relativePath,
      ),
    {
      attempts: RETRY_ATTEMPTS,
      shouldRetry: shouldRetrySyncResult,
      onRetry,
    },
  );

export const dev = async () => {
  const { config, credentials } = await loadConfigOrFail();
  const { apiBaseUrl, storeId } = config;
  const { apiKey } = credentials;
  const rootDir = getDistDir();
  let buildCleanup = null;
  let localPreviewServer = null;

  const buildResult = await build({ watch: true });
  if (!buildResult.ok) {
    ui.log.error("Initial build failed. Fix errors and try again.");
    process.exit(1);
  }
  buildCleanup = buildResult.cleanup;

  // Resolve preview via shared interactive picker
  const previewKey = await resolvePreviewKeyInteractively({ config, credentials });

  // Fetch preview to get hostname for local proxy
  const previewResult = await fetchPreviewDetails(
    apiBaseUrl,
    apiKey,
    storeId,
    previewKey,
  );
  if (!previewResult.ok) {
    ui.log.error(`Preview ${previewKey} not found.`);
    process.exit(1);
  }

  const previewHostname = previewResult.data.preview.previewHostname;
  const previewUrl = previewResult.data.url;

  const spinner = ui.spinner();
  spinner.start("Compressing files...");

  const uploadResult = await pushPreparedDirectoryToPreview({
    apiBaseUrl,
    apiKey,
    storeId,
    previewKey,
    rootDir,
    spinner,
    compressMessage: "Compressing files...",
    retryMessage: (result, nextAttempt) =>
      `Initial push failed. Retrying ${nextAttempt}/${RETRY_ATTEMPTS}... ${result.error}`,
  });

  if (!uploadResult.ok) {
    spinner.stop("Initial push failed.", 1);
    ui.log.error(uploadResult.error);
    process.exit(1);
  }

  try {
    localPreviewServer = await startLocalPreviewServer({
      apiBaseUrl,
      previewHostname,
    });
  } catch (error) {
    ui.log.warn(`Could not start local live preview: ${error.message}`);
  }

  spinner.stop(`Preview ready (${previewKey}).`);
  if (localPreviewServer) {
    ui.log.message(`Local live preview: ${localPreviewServer.url}`);
  }
  ui.log.message(`Sharable preview: ${previewUrl}`);

  ui.log.message("Watching for changes - press Ctrl+C to stop.");

  // ── File watcher ──────────────────────────────────────────────────────────
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
            storeId,
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
          } else {
            localPreviewServer?.notifyReload();
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
        storeId,
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
      } else {
        localPreviewServer?.notifyReload();
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

  const watcher = watch(rootDir, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    if (hasDotfileSegment(filename)) return;
    if (shouldIgnoreWatchedPath(filename, true)) return;

    const relativePath = filename.split(path.sep).join("/");
    queueSync(relativePath);
  });

  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;

    watcher.close();
    for (const timer of debounceMap.values()) clearTimeout(timer);

    await runCleanupStep("Local preview shutdown", () => localPreviewServer?.close());
    await runCleanupStep("Build watcher shutdown", buildCleanup);

    ui.outro("Dev mode stopped.");
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  await new Promise(() => {});
};
