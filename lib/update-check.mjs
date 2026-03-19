import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import * as p from "@clack/prompts";

const CONFIG_DIR = ".cli";
const UPDATE_CHECK_FILE = "update-check.json";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const NPM_REGISTRY_URL = "https://registry.npmjs.org/tiendu/latest";

const getUpdateCheckPath = () =>
  path.resolve(process.cwd(), CONFIG_DIR, UPDATE_CHECK_FILE);

/**
 * @returns {Promise<{ lastChecked: number, latestVersion: string | null } | null>}
 */
const readUpdateCheckState = async () => {
  try {
    const raw = await readFile(getUpdateCheckPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/**
 * @param {{ lastChecked: number, latestVersion: string | null }} state
 */
const writeUpdateCheckState = async (state) => {
  try {
    await mkdir(path.resolve(process.cwd(), CONFIG_DIR), { recursive: true });
    await writeFile(
      getUpdateCheckPath(),
      JSON.stringify(state, null, "\t") + "\n",
      "utf-8",
    );
  } catch {
    // silently ignore write errors
  }
};

/**
 * @returns {Promise<string | null>} latest version from npm, or null on error
 */
const fetchLatestVersion = async () => {
  try {
    const res = await fetch(NPM_REGISTRY_URL, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
};

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean} true if a is strictly older than b
 */
const isOlderVersion = (a, b) => {
  const parse = (v) => v.split(".").map(Number);
  const [aMajor, aMinor, aPatch] = parse(a);
  const [bMajor, bMinor, bPatch] = parse(b);
  if (aMajor !== bMajor) return aMajor < bMajor;
  if (aMinor !== bMinor) return aMinor < bMinor;
  return aPatch < bPatch;
};

/**
 * Reads local package.json version.
 * @returns {string}
 */
const getCurrentVersion = () => {
  // Resolved at import time via static path relative to this file
  return TIENDU_CLI_VERSION;
};

// This constant is replaced at build time via package.json version
// We read it dynamically to avoid hardcoding.
let TIENDU_CLI_VERSION = "0.0.0";
try {
  const pkgPath = new URL("../package.json", import.meta.url);
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
  TIENDU_CLI_VERSION = pkg.version ?? "0.0.0";
} catch {
  // ignore
}

/**
 * Check npm registry for a newer version at most once per day.
 * Shows a clack note if an update is available.
 * Does nothing if check fails — never blocks the user.
 */
export const checkForUpdates = async () => {
  const now = Date.now();
  const state = await readUpdateCheckState();

  // If checked within the last 24h, use cached result
  if (state && now - state.lastChecked < ONE_DAY_MS) {
    const currentVersion = TIENDU_CLI_VERSION;
    if (
      state.latestVersion &&
      isOlderVersion(currentVersion, state.latestVersion)
    ) {
      showUpdateNote(currentVersion, state.latestVersion);
    }
    return;
  }

  // Fetch latest version (non-blocking — failures are silent)
  const latestVersion = await fetchLatestVersion();

  await writeUpdateCheckState({ lastChecked: now, latestVersion });

  if (!latestVersion) {
    // Failed to check — don't show an error, just continue silently
    return;
  }

  const currentVersion = TIENDU_CLI_VERSION;
  if (isOlderVersion(currentVersion, latestVersion)) {
    showUpdateNote(currentVersion, latestVersion);
  }
};

/**
 * @param {string} current
 * @param {string} latest
 */
const showUpdateNote = (current, latest) => {
  p.note(
    [
      `A new version of Tiendu CLI is available! 🎉`,
      ``,
      `  ${current}  →  ${latest}`,
      ``,
      `Update by running:`,
      `  npm install -g tiendu@latest`,
    ].join("\n"),
    "Update available",
  );
};
