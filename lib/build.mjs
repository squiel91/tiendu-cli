import { watch } from "node:fs";
import {
  cp,
  mkdir,
  readdir,
  rm,
  stat,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
import * as esbuild from "esbuild";
import * as p from "@clack/prompts";
import { readThemeConfig } from "./config.mjs";

const THEME_DIRS = ["layout", "templates", "snippets", "assets"];

/**
 * Discover JS/TS and CSS entry points from src/layout and src/templates.
 * Returns separate maps for JS and CSS to avoid key collisions.
 */
const discoverEntryPoints = async (srcDir) => {
  const jsEntries = {};
  const cssEntries = {};

  for (const [dir, prefix] of [
    ["layout", "layout"],
    ["templates", "template"],
  ]) {
    const dirPath = path.join(srcDir, dir);
    let files;
    try {
      files = await readdir(dirPath);
    } catch {
      continue;
    }
    for (const file of files) {
      const ext = path.extname(file);
      if (![".js", ".ts", ".css"].includes(ext)) continue;
      const name = path.basename(file, ext);
      const key = `${prefix}-${name}.bundle`;
      const fullPath = path.join(dirPath, file);
      if (ext === ".css") {
        cssEntries[key] = fullPath;
      } else {
        jsEntries[key] = fullPath;
      }
    }
  }

  return { jsEntries, cssEntries };
};

/**
 * Copy theme directories (layout/, templates/, snippets/, assets/) to dist/.
 */
const copyThemeFiles = async (rootDir, distDir) => {
  for (const dir of THEME_DIRS) {
    const src = path.join(rootDir, dir);
    const dest = path.join(distDir, dir);
    try {
      await stat(src);
    } catch {
      continue;
    }
    await cp(src, dest, { recursive: true });
  }
};

/**
 * Copy a single file from root to dist, preserving relative path.
 */
const copySingleFile = async (rootDir, distDir, relativePath) => {
  const src = path.join(rootDir, relativePath);
  const dest = path.join(distDir, relativePath);
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(src, dest);
};

/**
 * Run a one-shot build or start watch mode.
 * @param {{ watch?: boolean }} options
 * @returns {Promise<{ ok: boolean, cleanup?: () => Promise<void> }>}
 */
export const build = async ({ watch: watchMode = false } = {}) => {
  const rootDir = process.cwd();
  const srcDir = path.join(rootDir, "src");
  const distDir = path.join(rootDir, "dist");

  const themeConfig = await readThemeConfig();
  if (!themeConfig) {
    p.log.error("No tiendu.config.json found. This is not a built theme.");
    return { ok: false };
  }

  // Clean and recreate dist
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  // Copy theme files first
  await copyThemeFiles(rootDir, distDir);

  // Discover entry points (JS and CSS separately to avoid key collisions)
  const { jsEntries, cssEntries } = await discoverEntryPoints(srcDir);
  const jsCount = Object.keys(jsEntries).length;
  const cssCount = Object.keys(cssEntries).length;
  const entryCount = jsCount + cssCount;

  if (entryCount === 0) {
    p.log.warn("No entry points found in src/layout or src/templates.");
    return { ok: true };
  }

  const outdir = path.join(distDir, "assets");
  const jsBuildOptions = jsCount > 0
    ? { entryPoints: jsEntries, bundle: true, format: "esm", target: "es2020", outdir, logLevel: "warning", write: true }
    : null;
  const cssBuildOptions = cssCount > 0
    ? { entryPoints: cssEntries, bundle: true, outdir, logLevel: "warning", write: true }
    : null;

  if (!watchMode) {
    // One-shot build
    try {
      const builds = [];
      if (jsBuildOptions) builds.push(esbuild.build(jsBuildOptions));
      if (cssBuildOptions) builds.push(esbuild.build(cssBuildOptions));
      await Promise.all(builds);
      p.log.success(
        `Built ${entryCount} entry point${entryCount === 1 ? "" : "s"} to dist/`,
      );
      return { ok: true };
    } catch (error) {
      p.log.error(`Build failed: ${error.message}`);
      return { ok: false };
    }
  }

  // Watch mode — create contexts for both JS and CSS
  const contexts = [];
  try {
    if (jsBuildOptions) {
      const jsCtx = await esbuild.context(jsBuildOptions);
      await jsCtx.watch();
      contexts.push(jsCtx);
    }
    if (cssBuildOptions) {
      const cssCtx = await esbuild.context(cssBuildOptions);
      await cssCtx.watch();
      contexts.push(cssCtx);
    }
  } catch (error) {
    p.log.error(`Build failed: ${error.message}`);
    for (const ctx of contexts) await ctx.dispose();
    return { ok: false };
  }

  p.log.success(
    `Built ${entryCount} entry point${entryCount === 1 ? "" : "s"}. Watching for changes...`,
  );

  // Watch theme directories for Liquid/static asset changes and copy to dist
  const themeWatchers = [];
  const debounceMap = new Map();
  const DEBOUNCE_MS = 200;

  for (const dir of THEME_DIRS) {
    const dirPath = path.join(rootDir, dir);
    try {
      await stat(dirPath);
    } catch {
      continue;
    }

    const watcher = watch(dirPath, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const relativePath = path.join(dir, filename);

      const existing = debounceMap.get(relativePath);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(async () => {
        debounceMap.delete(relativePath);
        try {
          const fileStat = await stat(path.join(rootDir, relativePath)).catch(
            () => null,
          );
          if (fileStat && fileStat.isFile()) {
            await copySingleFile(rootDir, distDir, relativePath);
            console.log(`⟳ ${relativePath}`);
          } else if (!fileStat) {
            // File deleted — remove from dist
            const dest = path.join(distDir, relativePath);
            await rm(dest, { force: true });
            console.log(`✕ ${relativePath}`);
          }
        } catch (error) {
          p.log.warn(`Error copying ${relativePath}: ${error.message}`);
        }
      }, DEBOUNCE_MS);

      debounceMap.set(relativePath, timer);
    });

    themeWatchers.push(watcher);
  }

  const cleanup = async () => {
    for (const w of themeWatchers) w.close();
    for (const timer of debounceMap.values()) clearTimeout(timer);
    for (const ctx of contexts) await ctx.dispose();
  };

  return { ok: true, cleanup };
};
