#!/usr/bin/env node

import { init } from "../lib/init.mjs";
import { pull } from "../lib/pull.mjs";
import { push } from "../lib/push.mjs";
import { dev } from "../lib/dev.mjs";
import { publish } from "../lib/publish.mjs";
import { build } from "../lib/build.mjs";
import {
  previewCreate,
  previewShow,
  previewList,
  previewDelete,
  previewOpen,
  previewAttach,
  previewDetach,
} from "../lib/preview.mjs";
import {
  checkForUpdates,
  checkForUpdatesNow,
  getCurrentVersion,
} from "../lib/update-check.mjs";

const HELP = `
tiendu — Tiendu theme development CLI

Usage:
  tiendu init [dir]          Set up a theme project (optionally in a new directory)
  tiendu pull [previewKey]   Download the live theme, or a specific preview's files
  tiendu build               Build a theme (requires tiendu.config.json)
  tiendu push [previewKey] [--skip-build]
                              Upload files to the attached or specified preview
  tiendu dev                 Start dev mode: auto-sync changes to a live preview URL
  tiendu publish [previewKey] [--skip-build]
                              Publish the attached or specified preview to the live storefront

  tiendu preview             Show the attached preview details
  tiendu preview create [name]
                              Create a new preview (and attach to it)
  tiendu preview list        List all previews for your store
  tiendu preview attach [key]
                              Attach to an existing preview by its key
  tiendu preview detach      Detach from the current preview (without deleting it)
  tiendu preview delete [key]
                              Delete a preview (defaults to the attached one)
  tiendu preview open        Open the attached preview URL in your browser

  tiendu check-updates       Check npm for a newer CLI version
  tiendu version             Show the current CLI version

  tiendu --help, -h          Show this help message
  tiendu --version, -v       Show the current CLI version

Typical workflow:
  tiendu init my-store       Set up a new project in ./my-store
  cd my-store
  tiendu pull                Download the current live theme
  tiendu build               Build the theme (for themes with tiendu.config.json)
  tiendu dev                 Edit locally — preview updates in real time
  tiendu publish             Ship to the live storefront when ready
`;

/**
 * Extract the first positional argument that is not a flag (--skip-build, etc.).
 * @param {string[]} args - CLI args after the command name
 * @returns {string | undefined}
 */
const extractPositionalArg = (args) =>
  args.find((arg) => !arg.startsWith("--"));

const main = async () => {
  const args = process.argv.slice(2);
  const command = args[0];
  const subcommand = args[1];
  const restArgs = args.slice(1);
  const skipBuild = args.includes("--skip-build");

  if (
    command === "version" ||
    command === "--version" ||
    command === "-v"
  ) {
    console.log(getCurrentVersion());
    process.exit(0);
  }

  if (
    !command ||
    command === "--help" ||
    command === "-h"
  ) {
    console.log(HELP.trim());
    process.exit(0);
  }

  if (command === "check-updates") {
    await checkForUpdatesNow();
    return;
  }

  // Check for updates at most once per day (non-blocking)
  await checkForUpdates();

  if (command === "init") {
    await init(args[1]); // optional directory name
    return;
  }

  if (command === "pull") {
    const previewKey = extractPositionalArg(restArgs);
    await pull({ previewKey });
    return;
  }

  if (command === "build") {
    const result = await build();
    if (!result.ok) process.exit(1);
    return;
  }

  if (command === "push") {
    const previewKey = extractPositionalArg(restArgs);
    await push({ skipBuild, previewKey });
    return;
  }

  if (command === "dev") {
    await dev();
    return;
  }

  if (command === "publish") {
    const previewKey = extractPositionalArg(restArgs);
    await publish({ skipBuild, previewKey });
    return;
  }

  if (command === "preview") {
    if (!subcommand) {
      await previewShow();
      return;
    }
    if (subcommand === "create") {
      await previewCreate(args[2]);
      return;
    }
    if (subcommand === "list") {
      await previewList();
      return;
    }
    if (subcommand === "attach") {
      await previewAttach(args[2]);
      return;
    }
    if (subcommand === "detach") {
      await previewDetach();
      return;
    }
    if (subcommand === "delete") {
      await previewDelete(args[2]);
      return;
    }
    if (subcommand === "open") {
      await previewOpen();
      return;
    }

    console.error(`Unknown subcommand: preview ${subcommand ?? "(none)"}`);
    console.log(HELP.trim());
    process.exit(1);
  }

  console.error(`Unknown command: ${command}`);
  console.log(HELP.trim());
  process.exit(1);
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
