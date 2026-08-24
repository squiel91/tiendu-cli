import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const TIENDUIGNORE_FILE = "tienduignore";

const DEFAULT_TIENDUIGNORE = `# Extra paths to skip on push, pull, and dev.
# .cli/, .git/, node_modules/, .env, .env.*, and .DS_Store are always skipped.

# Leftover build output from older CLI versions
dist/
`;

const ALWAYS_DENIED_SEGMENTS = new Set([".cli", ".git", "node_modules"]);

const toPosix = (relativePath) =>
  relativePath.split(path.sep).join("/").replace(/^\.\//, "").replace(/\/+$/, "");

const escapeRegex = (value) => value.replace(/[.+^${}()|[\]\\]/g, "\\$&");

const isAlwaysDeniedPath = (relativePath) => {
  const segments = toPosix(relativePath).split("/").filter(Boolean);
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    if (ALWAYS_DENIED_SEGMENTS.has(lower)) return true;
    if (lower === ".ds_store") return true;
    if (lower === ".env" || lower.startsWith(".env.")) return true;
  }
  return false;
};

const globToRegExp = (pattern) => {
  let source = "";
  let index = 0;

  while (index < pattern.length) {
    if (pattern.startsWith("**/", index)) {
      source += "(?:.*/)?";
      index += 3;
      continue;
    }
    if (pattern.slice(index, index + 2) === "**") {
      source += ".*";
      index += 2;
      continue;
    }
    if (pattern[index] === "*") {
      source += "[^/]*";
      index += 1;
      continue;
    }
    if (pattern[index] === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }
    source += escapeRegex(pattern[index]);
    index += 1;
  }

  return source;
};

const compilePattern = (rawPattern) => {
  let pattern = rawPattern.trim();
  if (!pattern || pattern.startsWith("#")) return null;

  let negated = false;
  if (pattern.startsWith("!")) {
    negated = true;
    pattern = pattern.slice(1);
  }

  if (pattern.startsWith("/")) {
    pattern = pattern.slice(1);
  }

  const directoryOnly = pattern.endsWith("/");
  if (directoryOnly) {
    pattern = pattern.slice(0, -1);
  }

  const anchored = pattern.includes("/");
  const body = globToRegExp(pattern);
  const prefix = anchored ? "^" : "(?:^|.*/)";
  const suffix = directoryOnly ? "(?:/.*)?$" : "$";

  return {
    negated,
    directoryOnly,
    regex: new RegExp(`${prefix}${body}${suffix}`),
  };
};

const parseIgnorePatterns = (contents) =>
  contents
    .split(/\r?\n/)
    .map(compilePattern)
    .filter(Boolean);

const pathMatches = (relativePath, isDirectory, pattern) => {
  const posixPath = toPosix(relativePath);
  if (!posixPath) return false;

  const candidates = [posixPath];
  if (isDirectory) candidates.push(`${posixPath}/`);

  return candidates.some((candidate) => pattern.regex.test(candidate.replace(/\/$/, "") || candidate));
};

/**
 * @param {string} [fileContents]
 * @returns {{ ignores: (relativePath: string, isDirectory?: boolean) => boolean }}
 */
const createIgnoreMatcher = (fileContents = "") => {
  const userPatterns = parseIgnorePatterns(fileContents);

  const ignores = (relativePath, isDirectory = false) => {
    if (isAlwaysDeniedPath(relativePath)) return true;

    let ignored = false;
    for (const pattern of userPatterns) {
      if (!pathMatches(relativePath, isDirectory || pattern.directoryOnly, pattern)) {
        continue;
      }
      ignored = !pattern.negated;
    }
    return ignored;
  };

  return { ignores };
};

export const loadTienduIgnore = async (rootDir) => {
  const ignorePath = path.join(rootDir, TIENDUIGNORE_FILE);
  try {
    const contents = await readFile(ignorePath, "utf-8");
    return createIgnoreMatcher(contents);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return createIgnoreMatcher("");
    }
    throw error;
  }
};

export const ensureTienduIgnoreFile = async (rootDir) => {
  const ignorePath = path.join(rootDir, TIENDUIGNORE_FILE);
  try {
    await readFile(ignorePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      await writeFile(ignorePath, DEFAULT_TIENDUIGNORE, "utf-8");
      return true;
    }
    throw error;
  }
  return false;
};
