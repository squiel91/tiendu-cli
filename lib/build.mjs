import { watch } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  copyFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import * as esbuild from "esbuild";
import { getThemePipelineConfig, readThemeConfig } from "./config.mjs";
import {
  flattenAssetLogicalPath,
  getAssetImportFilter,
  getAssetSourceInfo,
  getStaticAssetSourceDirs,
  syncSingleStaticAsset,
  syncStaticAssets,
} from "./assets.mjs";
import { listFilesRecursive } from "./fs-utils.mjs";
import { createCssPostCssPlugin } from "./postcss.mjs";
import * as ui from "./ui.mjs";

const THEME_SOURCE_OUTPUT_DIRS = [
  "layout",
  "templates",
  "sections",
  "blocks",
  "snippets",
  "config",
];
const LIQUID_LIKE_EXTENSIONS = new Set([".liquid", ".html", ".htm"]);
const ENTRY_SOURCE_EXTENSIONS = new Set([".js", ".ts", ".css"]);
const NESTED_ASSET_PATH_PATTERN =
  /\/assets\/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._/-]+)+)([?#][A-Za-z0-9=&._-]+)?/g;

/**
 * Discover optional JS/TS and CSS entry points from src/layout/templates or layout/templates.
 * Returns separate maps for JS and CSS to avoid key collisions.
 */
const discoverEntryPoints = async (rootDir) => {
  const jsEntries = {};
  const cssEntries = {};

  for (const [dir, prefix] of [
    ["layout", "layout"],
    ["templates", "template"],
  ]) {
    const sourceCandidates = [path.join(rootDir, "src", dir), path.join(rootDir, dir)];

    for (const dirPath of sourceCandidates) {
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

      break;
    }
  }

  return { jsEntries, cssEntries };
};

/**
 * @param {string} rootDir
 * @param {string} relativeDir
 * @returns {Promise<boolean>}
 */
const directoryExists = async (rootDir, relativeDir) => {
  try {
    const info = await stat(path.join(rootDir, relativeDir));
    return info.isDirectory();
  } catch {
    return false;
  }
};

const getThemeSourceDirs = async (rootDir) => {
  const resolvedDirs = [];

  for (const outputRelativeDir of THEME_SOURCE_OUTPUT_DIRS) {
    const sourceCandidates = [`src/${outputRelativeDir}`, outputRelativeDir];

    for (const sourceRelativeDir of sourceCandidates) {
      if (!(await directoryExists(rootDir, sourceRelativeDir))) continue;

      resolvedDirs.push({ sourceRelativeDir, outputRelativeDir });
      break;
    }
  }

  return resolvedDirs;
};

const rewriteDirectAssetPaths = (source, knownAssetLogicalPaths) =>
  source.replace(NESTED_ASSET_PATH_PATTERN, (match, assetPath, suffix = "") => {
    if (!knownAssetLogicalPaths.has(assetPath)) {
      return match;
    }

    const flattened = flattenAssetLogicalPath(assetPath);
    return flattened ? `/assets/${flattened}${suffix}` : match;
  });

const shouldCopyThemeSourceFile = (sourceRelativePath) => {
  const extension = path.extname(sourceRelativePath).toLowerCase();
  return !ENTRY_SOURCE_EXTENSIONS.has(extension);
};

const copyThemeSourceFile = async (
  rootDir,
  distDir,
  sourceRelativePath,
  outputRelativePath,
  knownAssetLogicalPaths,
) => {
  const src = path.join(rootDir, sourceRelativePath);
  const dest = path.join(distDir, outputRelativePath);
  await mkdir(path.dirname(dest), { recursive: true });

  if (LIQUID_LIKE_EXTENSIONS.has(path.extname(src).toLowerCase())) {
    const source = await readFile(src, "utf-8");
    await writeFile(
      dest,
      rewriteDirectAssetPaths(source, knownAssetLogicalPaths),
      "utf-8",
    );
    return;
  }

  await copyFile(src, dest);
};

const copyThemeFiles = async (
  rootDir,
  distDir,
  themeSourceDirs,
  knownAssetLogicalPaths,
) => {
  for (const sourceDir of themeSourceDirs) {
    const absoluteSourceDir = path.join(rootDir, sourceDir.sourceRelativeDir);
    const absoluteFiles = await listFilesRecursive(absoluteSourceDir);

    for (const absolutePath of absoluteFiles) {
      const nestedRelativePath = path.relative(absoluteSourceDir, absolutePath);
      const sourceRelativePath = path.join(
        sourceDir.sourceRelativeDir,
        nestedRelativePath,
      );
      const outputRelativePath = path.join(
        sourceDir.outputRelativeDir,
        nestedRelativePath,
      );
      if (!shouldCopyThemeSourceFile(sourceRelativePath)) continue;
      await copyThemeSourceFile(
        rootDir,
        distDir,
        sourceRelativePath,
        outputRelativePath,
        knownAssetLogicalPaths,
      );
    }
  }
};

const shouldTriggerTailwindCssRebuild = (relativePath) => {
  const normalizedPath = relativePath.split(path.sep).join("/");
  const extension = path.extname(normalizedPath).toLowerCase();

  if (
    !["layout/", "templates/", "sections/", "blocks/", "snippets/"].some(
      (prefix) => normalizedPath.startsWith(prefix),
    )
  ) {
    return false;
  }

  return [".liquid", ".html", ".htm", ".js", ".ts", ".json", ".md"].includes(
    extension,
  );
};

const createSourceAssetImportPlugin = (rootDir, sourceDirs) => ({
  name: "tiendu-source-assets",
  setup(build) {
    build.onResolve({ filter: getAssetImportFilter() }, async (args) => {
      if (!args.path.startsWith(".") && !args.path.startsWith("/")) {
        return null;
      }

      const candidatePath = path.isAbsolute(args.path)
        ? args.path
        : path.resolve(args.resolveDir, args.path);
      const assetInfo = await getAssetSourceInfo(
        rootDir,
        candidatePath,
        sourceDirs,
      );
      if (!assetInfo) return null;

      return {
        path: assetInfo.absolutePath,
        namespace: "tiendu-source-asset",
        pluginData: assetInfo,
      };
    });

    build.onLoad(
      { filter: /.*/, namespace: "tiendu-source-asset" },
      async (args) => {
        const assetInfo = args.pluginData;
        return {
          contents: `export default ${JSON.stringify(`/${assetInfo.outputRelativePath}`)};`,
          loader: "js",
          watchFiles: [assetInfo.absolutePath],
        };
      },
    );
  },
});

const runEntryBuilds = async (jsBuildOptions, cssBuildOptions) => {
  const builds = [];
  if (jsBuildOptions) builds.push(esbuild.build(jsBuildOptions));
  if (cssBuildOptions) builds.push(esbuild.build(cssBuildOptions));
  await Promise.all(builds);
};

/**
 * Run a one-shot build or start watch mode.
 * @param {{ watch?: boolean }} options
 * @returns {Promise<{ ok: boolean, cleanup?: () => Promise<void> }>}
 */
export const build = async ({ watch: watchMode = false } = {}) => {
  const rootDir = process.cwd();
  const distDir = path.join(rootDir, "dist");

  const themeConfig = await readThemeConfig();
  const pipeline = getThemePipelineConfig(themeConfig);

  if (pipeline.postcss && !pipeline.compileStyles) {
    ui.log.error(
      "Invalid tiendu.config.json: pipeline.postcss requires pipeline.compileStyles to be enabled.",
    );
    return { ok: false };
  }

  // Clean and recreate dist
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  const themeSourceDirs = await getThemeSourceDirs(rootDir);
  const staticAssetSourceDirs = await getStaticAssetSourceDirs(rootDir, {
    refresh: true,
  });

  // Discover entry points (JS and CSS separately to avoid key collisions)
  const discoveredEntries = await discoverEntryPoints(rootDir);
  const jsEntries = pipeline.compileScripts ? discoveredEntries.jsEntries : {};
  const cssEntries = pipeline.compileStyles ? discoveredEntries.cssEntries : {};
  const jsCount = Object.keys(jsEntries).length;
  const cssCount = Object.keys(cssEntries).length;
  const entryCount = jsCount + cssCount;
  const reservedOutputPaths = new Set([
    ...Object.keys(jsEntries).map((key) => `assets/${key}.js`),
    ...Object.keys(cssEntries).map((key) => `assets/${key}.css`),
  ]);
  let staticAssetOwners = new Map();
  const knownAssetLogicalPaths = new Set();
  const cssPlugins = [];
  const jsPlugins = pipeline.compileScripts
    ? [createSourceAssetImportPlugin(rootDir, staticAssetSourceDirs)]
    : [];

  try {
    staticAssetOwners = await syncStaticAssets(
      rootDir,
      distDir,
      reservedOutputPaths,
      staticAssetSourceDirs,
    );
  } catch (error) {
    ui.log.error(`Static asset build failed: ${error.message}`);
    return { ok: false };
  }

  for (const logicalPath of staticAssetOwners.values()) {
    knownAssetLogicalPaths.add(logicalPath);
  }

  // Copy theme files after asset paths are known
  await copyThemeFiles(
    rootDir,
    distDir,
    themeSourceDirs,
    knownAssetLogicalPaths,
  );

  if (cssCount > 0 && pipeline.postcss) {
    try {
      cssPlugins.push(
        await createCssPostCssPlugin(rootDir, {
          sourceDirs: staticAssetSourceDirs,
        }),
      );
    } catch (error) {
      ui.log.error(`CSS pipeline failed to initialize: ${error.message}`);
      return { ok: false };
    }
  }

  if (entryCount === 0) {
    const hasThemeFiles =
      themeSourceDirs.length > 0 || staticAssetSourceDirs.length > 0;

    if (!hasThemeFiles) {
      ui.log.error("No theme source files or entry points found.");
      return { ok: false };
    }

    if (!watchMode) {
      ui.log.success("Prepared theme files to dist/.");
      return { ok: true };
    }
  }

  const outdir = path.join(distDir, "assets");
  const jsBuildOptions =
    jsCount > 0
      ? {
          entryPoints: jsEntries,
          bundle: true,
          format: "esm",
          target: "es2020",
          outdir,
          logLevel: "warning",
          write: true,
          resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
          plugins: jsPlugins,
        }
      : null;
  const cssBuildOptions =
    cssCount > 0
      ? {
          entryPoints: cssEntries,
          bundle: true,
          outdir,
          logLevel: "warning",
          write: true,
          plugins: cssPlugins,
        }
      : null;

  if (!watchMode) {
    // One-shot build
    try {
      await runEntryBuilds(jsBuildOptions, cssBuildOptions);
      if (entryCount === 0) {
        ui.log.success("Prepared theme files to dist/.");
      } else {
        ui.log.success(
          `Built ${entryCount} entry point${entryCount === 1 ? "" : "s"} to dist/`,
        );
      }
      return { ok: true };
    } catch (error) {
      ui.log.error(`Build failed: ${error.message}`);
      return { ok: false };
    }
  }

  // Watch mode — create contexts for both JS and CSS
  const contexts = [];
  let cssCtx = null;
  try {
    await runEntryBuilds(jsBuildOptions, cssBuildOptions);

    if (jsBuildOptions) {
      const jsCtx = await esbuild.context(jsBuildOptions);
      await jsCtx.watch();
      contexts.push(jsCtx);
    }
    if (cssBuildOptions) {
      cssCtx = await esbuild.context(cssBuildOptions);
      await cssCtx.watch();
      contexts.push(cssCtx);
    }
  } catch (error) {
    ui.log.error(`Build failed: ${error.message}`);
    for (const ctx of contexts) await ctx.dispose();
    return { ok: false };
  }

  if (entryCount === 0) {
    ui.log.success("Prepared theme files. Watching for changes...");
  } else {
    ui.log.success(
      `Built ${entryCount} entry point${entryCount === 1 ? "" : "s"}. Watching for changes...`,
    );
  }

  // Watch theme directories for Liquid/static asset changes and copy to dist
  const themeWatchers = [];
  const debounceMap = new Map();
  const DEBOUNCE_MS = 200;
  let cssRebuildTimer = null;
  let cssRebuildInFlight = false;
  let cssRebuildQueued = false;

  const runCssRebuild = async () => {
    if (!cssCtx) return;
    if (cssRebuildInFlight) {
      cssRebuildQueued = true;
      return;
    }

    cssRebuildInFlight = true;

    try {
      await cssCtx.rebuild();
      console.log("CSS bundles updated");
    } catch (error) {
      ui.log.warn(`Error rebuilding CSS: ${error.message}`);
    } finally {
      cssRebuildInFlight = false;
      if (cssRebuildQueued) {
        cssRebuildQueued = false;
        queueCssRebuild();
      }
    }
  };

  const queueCssRebuild = () => {
    if (!cssCtx) return;
    if (cssRebuildTimer) clearTimeout(cssRebuildTimer);

    cssRebuildTimer = setTimeout(() => {
      cssRebuildTimer = null;
      void runCssRebuild();
    }, DEBOUNCE_MS);
  };

  const handleStaticAssetChange = async (relativePath) => {
    const result = await syncSingleStaticAsset(
      rootDir,
      distDir,
      relativePath,
      reservedOutputPaths,
      staticAssetOwners,
      staticAssetSourceDirs,
    );

    if (!result) return;

    if (result.type === "copy") {
      knownAssetLogicalPaths.add(result.logicalPath);
    } else {
      knownAssetLogicalPaths.delete(result.logicalPath);
    }

    console.log(
      `${result.type === "delete" ? "DELETE" : "UPDATE"} ${result.outputRelativePath}`,
    );
  };

  for (const sourceDir of themeSourceDirs) {
    const dirPath = path.join(rootDir, sourceDir.sourceRelativeDir);

    const watcher = watch(
      dirPath,
      { recursive: true },
      (eventType, filename) => {
        if (!filename) return;
        const normalizedFilename = filename.split(path.sep).join("/");
        const sourceRelativePath = `${sourceDir.sourceRelativeDir}/${normalizedFilename}`;
        const outputRelativePath = `${sourceDir.outputRelativeDir}/${normalizedFilename}`;

        const existing = debounceMap.get(sourceRelativePath);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(async () => {
          debounceMap.delete(sourceRelativePath);
          try {
            if (!shouldCopyThemeSourceFile(sourceRelativePath)) {
              return;
            }

            const fileStat = await stat(
              path.join(rootDir, sourceRelativePath),
            ).catch(() => null);
            if (fileStat && fileStat.isFile()) {
              await copyThemeSourceFile(
                rootDir,
                distDir,
                sourceRelativePath,
                outputRelativePath,
                knownAssetLogicalPaths,
              );
              console.log(`UPDATE ${outputRelativePath}`);
            } else if (!fileStat) {
              // File deleted — remove from dist
              const dest = path.join(distDir, outputRelativePath);
              await rm(dest, { force: true });
              console.log(`DELETE ${outputRelativePath}`);
            }

            if (
              pipeline.compileStyles &&
              shouldTriggerTailwindCssRebuild(outputRelativePath)
            ) {
              queueCssRebuild();
            }
          } catch (error) {
            ui.log.warn(
              `Error copying ${sourceRelativePath}: ${error.message}`,
            );
          }
        }, DEBOUNCE_MS);

        debounceMap.set(sourceRelativePath, timer);
      },
    );

    themeWatchers.push(watcher);
  }

  for (const assetDir of await getStaticAssetSourceDirs(rootDir)) {
    const watcher = watch(
      assetDir.absoluteDir,
      { recursive: true },
      (eventType, filename) => {
        if (!filename) return;
        const relativePath = `${assetDir.relativeDir}/${filename.split(path.sep).join("/")}`;

        const existing = debounceMap.get(relativePath);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(async () => {
          debounceMap.delete(relativePath);
          try {
            await handleStaticAssetChange(relativePath);
          } catch (error) {
            const errorLabel = error.message.includes("Asset collision")
              ? "Asset collision"
              : "Error compiling";
            ui.log.warn(`${errorLabel} ${relativePath}: ${error.message}`);
          }
        }, DEBOUNCE_MS);

        debounceMap.set(relativePath, timer);
      },
    );

    themeWatchers.push(watcher);
  }

  const cleanup = async () => {
    for (const w of themeWatchers) w.close();
    for (const timer of debounceMap.values()) clearTimeout(timer);
    if (cssRebuildTimer) clearTimeout(cssRebuildTimer);
    for (const ctx of contexts) await ctx.dispose();
  };

  return { ok: true, cleanup };
};
