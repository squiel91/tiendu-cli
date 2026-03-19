#!/usr/bin/env node

import { init } from "../lib/init.mjs";
import { pull } from "../lib/pull.mjs";
import { push } from "../lib/push.mjs";
import { dev } from "../lib/dev.mjs";
import { publish } from "../lib/publish.mjs";
import {
  previewCreate,
  previewShow,
  previewList,
  previewDelete,
  previewOpen,
} from "../lib/preview.mjs";
import { checkForUpdates } from "../lib/update-check.mjs";

const HELP = `
tiendu — Tiendu theme development CLI

Usage:
  tiendu init [dir]          Set up a theme project (optionally in a new directory)
  tiendu pull                Download the live theme from your store
  tiendu push                Upload local files to the active preview (full replace)
  tiendu dev                 Start dev mode: auto-sync changes to a live preview URL
  tiendu publish             Publish the active preview to the live storefront

  tiendu preview             Show the active preview details
  tiendu preview create      Create a new remote preview
  tiendu preview list        List previews for your store
  tiendu preview delete      Delete the active preview
  tiendu preview open        Open the active preview URL in your browser

  tiendu help                Show this help message

Typical workflow:
  tiendu init my-store       Set up a new project in ./my-store
  cd my-store
  tiendu pull                Download the current live theme
  tiendu dev                 Edit locally — preview updates in real time
  tiendu publish             Ship to the live storefront when ready
`;

const main = async () => {
  const args = process.argv.slice(2);
  const command = args[0];
  const subcommand = args[1];

  // Check for updates at most once per day (non-blocking)
  await checkForUpdates();

  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    console.log(HELP.trim());
    process.exit(0);
  }

  if (command === "init") {
    await init(args[1]); // optional directory name
    return;
  }

  if (command === "pull") {
    await pull();
    return;
  }

  if (command === "push") {
    await push();
    return;
  }

  if (command === "dev") {
    await dev();
    return;
  }

  if (command === "publish") {
    await publish();
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
    if (subcommand === "delete") {
      await previewDelete();
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
