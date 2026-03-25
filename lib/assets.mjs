import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileExists, listFilesRecursive } from "./fs-utils.mjs";

const STATIC_ASSET_SOURCE_DIRS = ["src/assets", "assets"];
const ASSET_IMPORT_EXTENSIONS = [
  ".apng",
  ".avif",
  ".bmp",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".mp3",
  ".mp4",
  ".ogg",
  ".otf",
  ".pdf",
  ".png",
  ".svg",
  ".ttf",
  ".wav",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
];

const toPosixPath = (value) => value.split(path.sep).join("/");

const hasAssetExtension = (filePath) =>
  ASSET_IMPORT_EXTENSIONS.includes(path.extname(filePath).toLowerCase());

const staticAssetSourceDirsCache = new Map();

const buildAssetSourceInfo = (resolvedPath, logicalPath, sourceDir) => ({
  absolutePath: resolvedPath,
  logicalPath,
  outputRelativePath: getFlattenedAssetRelativePath(logicalPath),
  sourceDir: sourceDir.relativeDir,
});

const resolveAssetSourceInfo = (sourceDirs, absolutePath) => {
  const resolvedPath = path.resolve(absolutePath);

  for (const sourceDir of sourceDirs) {
    const relativePath = path.relative(sourceDir.absoluteDir, resolvedPath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      continue;
    }

    return buildAssetSourceInfo(resolvedPath, toPosixPath(relativePath), sourceDir);
  }

  return null;
};

const resolveAssetSourceInfoFromRelativePath = (rootDir, sourceDirs, relativePath) => {
  const normalizedRelativePath = toPosixPath(relativePath);

  for (const sourceDir of sourceDirs) {
    const sourcePrefix = `${sourceDir.relativeDir}/`;
    if (!normalizedRelativePath.startsWith(sourcePrefix)) continue;

    const logicalPath = normalizedRelativePath.slice(sourcePrefix.length);
    return buildAssetSourceInfo(
      path.join(rootDir, normalizedRelativePath),
      logicalPath,
      sourceDir,
    );
  }

  return null;
};

export const getStaticAssetSourceDirs = async (rootDir, { refresh = false } = {}) => {
  if (!refresh && staticAssetSourceDirsCache.has(rootDir)) {
    return staticAssetSourceDirsCache.get(rootDir);
  }

  const directories = [];

  for (const relativeDir of STATIC_ASSET_SOURCE_DIRS) {
    const absoluteDir = path.join(rootDir, relativeDir);
    if (!(await fileExists(absoluteDir))) continue;

    directories.push({
      absoluteDir,
      relativeDir: toPosixPath(relativeDir),
    });
  }

  staticAssetSourceDirsCache.set(rootDir, directories);
  return directories;
};

export const normalizeAssetLogicalPath = (input) => {
  if (typeof input !== "string") return "";

  let normalized = input.trim().replace(/^\/+/, "").replace(/\\/g, "/");

  if (normalized.startsWith("src/assets/")) {
    normalized = normalized.slice("src/assets/".length);
  } else if (normalized.startsWith("assets/") && !normalized.startsWith("assets/assets/")) {
    normalized = normalized.slice("assets/".length);
  }

  return normalized.replace(/^\/+/, "");
};

export const flattenAssetLogicalPath = (logicalPath) => {
  const normalized = normalizeAssetLogicalPath(logicalPath);
  if (!normalized) return "";

  return normalized.split("/").filter(Boolean).join("___");
};

export const getFlattenedAssetRelativePath = (logicalPath) => {
  const flattenedName = flattenAssetLogicalPath(logicalPath);
  return flattenedName ? `assets/${flattenedName}` : "";
};

export const getAssetSourceInfo = async (rootDir, absolutePath, sourceDirs) => {
  return resolveAssetSourceInfo(
    sourceDirs ?? await getStaticAssetSourceDirs(rootDir),
    absolutePath,
  );
};

export const getAssetSourceInfoFromRelativePath = async (rootDir, relativePath, sourceDirs) => {
  return resolveAssetSourceInfoFromRelativePath(
    rootDir,
    sourceDirs ?? await getStaticAssetSourceDirs(rootDir),
    relativePath,
  );
};

export const getAssetImportFilter = () =>
  new RegExp(`\\.(${ASSET_IMPORT_EXTENSIONS.map((extension) => extension.slice(1)).join("|")})$`, "i");

export const isSupportedAssetImport = (filePath) => hasAssetExtension(filePath);

export const rewriteCssAssetUrls = async (source, cssFilePath, rootDir, sourceDirs) => {
  const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'"()]+)\1\s*\)/g;
  const resolvedSourceDirs = sourceDirs ?? await getStaticAssetSourceDirs(rootDir);

  return source.replace(CSS_URL_PATTERN, (fullMatch, _quote, rawValue) => {
    const rawPath = rawValue?.trim() ?? "";
    if (!rawPath || rawPath.startsWith("data:") || rawPath.startsWith("http://") || rawPath.startsWith("https://") || rawPath.startsWith("/assets/") || rawPath.startsWith("#")) {
      return fullMatch;
    }

    const resolvedPath = path.resolve(path.dirname(cssFilePath), rawPath);
    const assetInfo = resolveAssetSourceInfo(resolvedSourceDirs, resolvedPath);
    if (!assetInfo) return fullMatch;

    return `url("/${assetInfo.outputRelativePath}")`;
  });
};

export const syncStaticAssets = async (rootDir, distDir, reservedOutputPaths = new Set(), sourceDirs) => {
  const resolvedSourceDirs = sourceDirs ?? await getStaticAssetSourceDirs(rootDir);
  const outputDir = path.join(distDir, "assets");
  await mkdir(outputDir, { recursive: true });

  const claimedOutputs = new Map();

  for (const sourceDir of resolvedSourceDirs) {
    const absoluteFiles = await listFilesRecursive(sourceDir.absoluteDir);

    for (const absolutePath of absoluteFiles) {
      const assetInfo = resolveAssetSourceInfo(resolvedSourceDirs, absolutePath);
      if (!assetInfo) continue;

      if (reservedOutputPaths.has(assetInfo.outputRelativePath)) {
        throw new Error(
          `Asset ${assetInfo.logicalPath} conflicts with a generated bundle at ${assetInfo.outputRelativePath}.`,
        );
      }

      const previousOwner = claimedOutputs.get(assetInfo.outputRelativePath);
      if (previousOwner && previousOwner !== assetInfo.logicalPath) {
        throw new Error(
          `Asset collision: ${previousOwner} and ${assetInfo.logicalPath} both flatten to ${assetInfo.outputRelativePath}.`,
        );
      }

      claimedOutputs.set(assetInfo.outputRelativePath, assetInfo.logicalPath);

      const outputPath = path.join(distDir, assetInfo.outputRelativePath);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await copyFile(absolutePath, outputPath);
    }
  }

  return claimedOutputs;
};

export const syncSingleStaticAsset = async (
  rootDir,
  distDir,
  relativePath,
  reservedOutputPaths = new Set(),
  claimedOutputs = new Map(),
  sourceDirs,
) => {
  const resolvedSourceDirs = sourceDirs ?? await getStaticAssetSourceDirs(rootDir);
  const assetInfo = resolveAssetSourceInfoFromRelativePath(rootDir, resolvedSourceDirs, relativePath);
  if (!assetInfo) return null;

  if (reservedOutputPaths.has(assetInfo.outputRelativePath)) {
    throw new Error(
      `Asset ${assetInfo.logicalPath} conflicts with a generated bundle at ${assetInfo.outputRelativePath}.`,
    );
  }

  const outputPath = path.join(distDir, assetInfo.outputRelativePath);
  const sourceExists = await fileExists(assetInfo.absolutePath);

  if (!sourceExists) {
    claimedOutputs.delete(assetInfo.outputRelativePath);
    await rm(outputPath, { force: true });
    return {
      type: "delete",
      logicalPath: assetInfo.logicalPath,
      outputRelativePath: assetInfo.outputRelativePath,
    };
  }

  const previousOwner = claimedOutputs.get(assetInfo.outputRelativePath);
  if (previousOwner && previousOwner !== assetInfo.logicalPath) {
    throw new Error(
      `Asset collision: ${previousOwner} and ${assetInfo.logicalPath} both flatten to ${assetInfo.outputRelativePath}.`,
    );
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await copyFile(assetInfo.absolutePath, outputPath);
  claimedOutputs.set(assetInfo.outputRelativePath, assetInfo.logicalPath);
  return {
    type: "copy",
    logicalPath: assetInfo.logicalPath,
    outputRelativePath: assetInfo.outputRelativePath,
  };
};
