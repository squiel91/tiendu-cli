import { watch } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import * as p from "@clack/prompts";
import { zipSync } from "fflate";
import { loadConfigOrFail, writeConfig } from "./config.mjs";
import {
  createPreview,
  listPreviews,
  resolveActivePreview,
} from "./preview.mjs";
import {
  deletePreviewFile,
  uploadPreviewFileMultipart,
  uploadPreviewZip,
} from "./api.mjs";

const isDotfile = (name) => name.startsWith(".");

const buildPreviewUrl = (apiBaseUrl, previewHostname) => {
  const base = new URL(apiBaseUrl);
  const hasExplicitPort = previewHostname.includes(":");
  return `${base.protocol}//${previewHostname}${!hasExplicitPort && base.port ? `:${base.port}` : ""}/`;
};

const hasDotfileSegment = (relativePath) =>
  relativePath.split(path.sep).some(isDotfile);

const listAllFiles = async (rootDir, currentDir) => {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (isDotfile(entry.name)) continue;
    const abs = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listAllFiles(rootDir, abs)));
    } else if (entry.isFile()) {
      files.push(abs);
    }
  }
  return files;
};

const createZipFromDirectory = async (rootDir) => {
  const absoluteFiles = await listAllFiles(rootDir, rootDir);
  /** @type {Record<string, Uint8Array>} */
  const entries = {};
  for (const abs of absoluteFiles) {
    const rel = path.relative(rootDir, abs).split(path.sep).join("/");
    entries[rel] = new Uint8Array(await readFile(abs));
  }
  return Buffer.from(zipSync(entries, { level: 6 }));
};

export const dev = async () => {
  const { config, credentials } = await loadConfigOrFail();
  const { apiBaseUrl, storeId } = config;
  const { apiKey } = credentials;
  const rootDir = process.cwd();

  const existingPreviewsResult = await listPreviews(
    apiBaseUrl,
    apiKey,
    storeId,
  );
  if (!existingPreviewsResult.ok) {
    p.log.error(existingPreviewsResult.error);
    process.exit(1);
  }

  let previewKey =
    resolveActivePreview(existingPreviewsResult.data, config.previewKey)
      ?.previewKey ?? config.previewKey;
  let previewUrl;

  if (!previewKey) {
    // ── Create preview and do initial upload ─────────────────────────────────
    const spinner = p.spinner();
    spinner.start("No active preview found. Creating one...");

    const result = await createPreview(apiBaseUrl, apiKey, storeId, "Dev");
    if (!result.ok) {
      spinner.stop("Failed to create preview.", 1);
      p.log.error(result.error);
      process.exit(1);
    }

    previewKey = result.data.previewKey;
    previewUrl = buildPreviewUrl(apiBaseUrl, result.data.previewHostname);
    await writeConfig({ ...config, previewKey });

    spinner.message("Uploading initial files...");
    const zipBuffer = await createZipFromDirectory(rootDir);
    const uploadResult = await uploadPreviewZip(
      apiBaseUrl,
      apiKey,
      storeId,
      previewKey,
      zipBuffer,
    );

    if (!uploadResult.ok) {
      spinner.stop("Failed to upload files.", 1);
      p.log.error(uploadResult.error);
      process.exit(1);
    }

    spinner.stop(`Preview ready: ${previewUrl}`);
  } else {
    // ── Verify existing preview still exists ─────────────────────────────────
    const spinner = p.spinner();
    spinner.start("Connecting to preview...");

    const listResult = await listPreviews(apiBaseUrl, apiKey, storeId);
    if (!listResult.ok) {
      spinner.stop("Failed to connect.", 1);
      p.log.error(listResult.error);
      process.exit(1);
    }

    const existing = resolveActivePreview(listResult.data, previewKey);
    if (!existing) {
      spinner.stop("Could not determine the active preview.", 1);
      p.log.error(
        listResult.data.length === 0
          ? "No previews found for this store. A new preview will be created if you clear the local config and run tiendu dev again."
          : "Run tiendu preview list and then set or recreate the preview.",
      );
      process.exit(1);
    }

    previewKey = existing.previewKey;
    if (config.previewKey !== previewKey) {
      await writeConfig({ ...config, previewKey });
    }

    previewUrl = buildPreviewUrl(apiBaseUrl, existing.previewHostname);
    spinner.stop(`Preview: ${previewUrl}`);
  }

  p.log.message("Watching for changes — press Ctrl+C to stop.");

  // ── File watcher ──────────────────────────────────────────────────────────
  /** @type {Map<string, NodeJS.Timeout>} */
  const debounceMap = new Map();
  const DEBOUNCE_MS = 300;

  const watcher = watch(rootDir, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    if (hasDotfileSegment(filename)) return;

    const relativePath = filename.split(path.sep).join("/");
    const existing = debounceMap.get(relativePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      debounceMap.delete(relativePath);
      const absolutePath = path.join(rootDir, filename);

      try {
        const fileStat = await stat(absolutePath).catch(() => null);

        if (!fileStat || !fileStat.isFile()) {
          if (!fileStat) {
            console.log(`✕ ${relativePath}`);
            const result = await deletePreviewFile(
              apiBaseUrl,
              apiKey,
              storeId,
              previewKey,
              relativePath,
            );
            if (!result.ok) {
              p.log.warn(`     Failed to delete: ${result.error}`);
            }
          }
          return;
        }

        console.log(`↑ ${relativePath}`);
        const content = await readFile(absolutePath);
        const result = await uploadPreviewFileMultipart(
          apiBaseUrl,
          apiKey,
          storeId,
          previewKey,
          relativePath,
          content,
        );

        if (!result.ok) {
          p.log.warn(`     Failed to upload: ${result.error}`);
        }
      } catch (error) {
        p.log.warn(`     Error processing ${relativePath}: ${error.message}`);
      }
    }, DEBOUNCE_MS);

    debounceMap.set(relativePath, timer);
  });

  const cleanup = () => {
    watcher.close();
    for (const timer of debounceMap.values()) clearTimeout(timer);
    p.outro("Dev mode stopped.");
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  await new Promise(() => {});
};
