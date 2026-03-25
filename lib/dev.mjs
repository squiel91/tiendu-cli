import { watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import * as p from "@clack/prompts";
import { loadConfigOrFail, writeConfig, isBuiltTheme, getDistDir } from "./config.mjs";
import {
  createPreview,
  listPreviews,
  resolveActivePreview,
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

const RETRY_ATTEMPTS = 3;

const buildPreviewUrl = (apiBaseUrl, previewHostname) => {
  const base = new URL(apiBaseUrl);
  const hasExplicitPort = previewHostname.includes(":");
  return `${base.protocol}//${previewHostname}${!hasExplicitPort && base.port ? `:${base.port}` : ""}/`;
};

const hasDotfileSegment = (relativePath) =>
  relativePath.split(path.sep).some(isDotfile);

const shouldRetrySyncResult = (result) =>
  !result.ok && Boolean(result.retriable);

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

const resolvePreviewForDev = (previews, configuredPreviewKey) => {
  const activePreview = resolveActivePreview(previews, configuredPreviewKey);
  if (activePreview) return activePreview;

  if (configuredPreviewKey && previews.length === 1) {
    return previews[0];
  }

  return null;
};

export const dev = async () => {
  const { config, credentials } = await loadConfigOrFail();
  const { apiBaseUrl, storeId } = config;
  const { apiKey } = credentials;
  const builtTheme = await isBuiltTheme();
  const rootDir = builtTheme ? getDistDir() : process.cwd();
  let buildCleanup = null;
  let localPreviewServer = null;

  // For built themes, run the build first (with watch mode)
  if (builtTheme) {
    const buildResult = await build({ watch: true });
    if (!buildResult.ok) {
      p.log.error("Initial build failed. Fix errors and try again.");
      process.exit(1);
    }
    buildCleanup = buildResult.cleanup;
  }

  const spinner = p.spinner();
  spinner.start("Connecting to preview...");

  const listResult = await listPreviews(apiBaseUrl, apiKey, storeId);
  if (!listResult.ok) {
    spinner.stop("Failed to connect.", 1);
    p.log.error(listResult.error);
    process.exit(1);
  }

  let activePreview = resolvePreviewForDev(listResult.data, config.previewKey);
  if (!activePreview) {
    if (config.previewKey) {
      p.log.warn(
        `Stored preview ${config.previewKey} was not found. Creating a new preview...`,
      );
    }

    spinner.message("Creating preview...");
    const previewResult = await createPreview(apiBaseUrl, apiKey, storeId, "Dev");
    if (!previewResult.ok) {
      spinner.stop("Failed to create preview.", 1);
      p.log.error(previewResult.error);
      process.exit(1);
    }

    activePreview = previewResult.data;
  }

  const previewKey = activePreview.previewKey;
  if (config.previewKey !== previewKey) {
    await writeConfig({ ...config, previewKey });
  }

  const previewUrl = buildPreviewUrl(apiBaseUrl, activePreview.previewHostname);

  const uploadResult = await pushPreparedDirectoryToPreview({
    apiBaseUrl,
    apiKey,
    storeId,
    previewKey,
    rootDir,
    spinner,
    packMessage: "Running initial push...",
    retryMessage: (result, nextAttempt) =>
      `Initial push failed. Retrying ${nextAttempt}/${RETRY_ATTEMPTS}... ${result.error}`,
  });

  if (!uploadResult.ok) {
    spinner.stop("Initial push failed.", 1);
    p.log.error(uploadResult.error);
    process.exit(1);
  }

  try {
    localPreviewServer = await startLocalPreviewServer({
      apiBaseUrl,
      previewHostname: activePreview.previewHostname,
    });
  } catch (error) {
    p.log.warn(`Could not start local live preview: ${error.message}`);
  }

  spinner.stop("Preview ready.");
  if (localPreviewServer) {
    p.log.message(`Local live preview: ${localPreviewServer.url}`);
  }
  p.log.message(`Sharable preview: ${previewUrl}`);

  p.log.message("Watching for changes — press Ctrl+C to stop.");

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
          console.log(`✕ ${relativePath}`);
          const result = await deleteFileWithRetries(
            apiBaseUrl,
            apiKey,
            storeId,
            previewKey,
            relativePath,
            async (_, nextAttempt) => {
              p.log.warn(
                `     Retry delete ${relativePath} (${nextAttempt}/${RETRY_ATTEMPTS})`,
              );
            },
          );

          if (!result.ok) {
            p.log.warn(`     Failed to delete after ${RETRY_ATTEMPTS} attempts: ${result.error}`);
          } else {
            localPreviewServer?.notifyReload();
          }
        }

        return;
      }

      console.log(`↑ ${relativePath}`);
      const content = await readFile(absolutePath);
      const result = await uploadFileWithRetries(
        apiBaseUrl,
        apiKey,
        storeId,
        previewKey,
        relativePath,
        content,
        async (_, nextAttempt) => {
          p.log.warn(
            `     Retry upload ${relativePath} (${nextAttempt}/${RETRY_ATTEMPTS})`,
          );
        },
      );

      if (!result.ok) {
        p.log.warn(`     Failed to upload after ${RETRY_ATTEMPTS} attempts: ${result.error}`);
      } else {
        localPreviewServer?.notifyReload();
      }
    } catch (error) {
      p.log.warn(`     Error processing ${relativePath}: ${error.message}`);
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

    const relativePath = filename.split(path.sep).join("/");
    queueSync(relativePath);
  });

  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;

    watcher.close();
    for (const timer of debounceMap.values()) clearTimeout(timer);
    if (localPreviewServer) await localPreviewServer.close();
    if (buildCleanup) await buildCleanup();
    p.outro("Dev mode stopped.");
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  await new Promise(() => {});
};
