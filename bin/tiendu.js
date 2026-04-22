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
import { storesList, storesSet } from "../lib/stores.mjs";
import {
  checkForUpdates,
  checkForUpdatesNow,
  getCurrentVersion,
} from "../lib/update-check.mjs";
import { configureUi } from "../lib/ui.mjs";

const HELP = `
tiendu — Tiendu theme development CLI

Usage:
  tiendu init [apiKey] [baseUrl] [--dir <path>]
                               Initialize interactively, or reset config with direct credentials
  tiendu stores list           List stores available for the configured API key
  tiendu stores set <storeId>  Select the active store
  tiendu pull [previewKey]     Download the live theme or a preview into dist/
  tiendu build                 Build or stage the current theme into dist/
  tiendu push [previewKey] [--skip-build]
                               Upload dist/ to the attached or specified preview
  tiendu dev                   Start dev mode: auto-sync changes to a live preview URL
  tiendu publish [previewKey] [--skip-build]
                               Build/sync dist/ and publish the preview live

  tiendu preview               Show the attached preview details
  tiendu preview create [name]
                               Create a new preview (and attach to it)
  tiendu preview list          List all previews for your store
  tiendu preview attach [key]  Attach to an existing preview by its key
  tiendu preview detach        Detach from the current preview (without deleting it)
  tiendu preview delete [key]  Delete a preview (defaults to the attached one)
  tiendu preview open          Open the attached preview URL in your browser

  tiendu check-updates         Check npm for a newer CLI version
  tiendu version               Show the current CLI version

Global options:
  --non-interactive            Disable prompts, print plain text output, and skip confirmations
  --dir <path>                 Create the project inside a new directory during init
  --skip-build                 Reuse the existing dist/ output for push or publish
  --skip-instances             Skip template/section group JSON and settings_data.json (preserves existing instances on the preview)
  --help, -h                   Show this help message
  --version, -v                Show the current CLI version

Init behavior:
  tiendu init                  Interactive setup wizard
  tiendu init <apiKey>         Reset saved config and connect using the default base URL
  tiendu init <apiKey> <url>   Reset saved config and connect using a custom base URL
  The default base URL points to the Tiendu platform and rarely needs to change.
  If exactly one store is available, it is selected automatically.
  If multiple stores are available, run tiendu stores list and tiendu stores set <id>.

Agent-friendly setup:
  tiendu init <apiKey> [baseUrl] --non-interactive
  tiendu stores list --non-interactive
  tiendu stores set <id> --non-interactive
  tiendu pull --non-interactive
  tiendu push --non-interactive
  tiendu publish --non-interactive

Push and pull behavior:
  build always prepares dist/ as the local deploy artifact.
  push sends a zip of dist/ to the target preview.
  pull resets dist/ and extracts the downloaded theme there.
  pull does not delete src/ files.

Pipeline behavior:
  tiendu.config.json can enable optional pipeline steps.
  pipeline.compileScripts enables JS/TS entry compilation.
  pipeline.compileStyles enables CSS entry compilation.
  pipeline.postcss enables PostCSS for compiled style entries.
  With no config file, or with no enabled pipeline steps, build just stages theme files into dist/.

Typical workflow:
  tiendu init                  Connect to Tiendu and save your credentials
  tiendu stores list           See available stores
  tiendu stores set <id>       Select the store you want to work on
  tiendu pull                  Refresh dist/ from the current live theme
  tiendu dev                   Edit locally — preview updates in real time
  tiendu publish               Ship to the live storefront when ready
`;

const parseArgv = (argv) => {
  const flags = new Set();
  const values = new Map();
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    if (arg === "--dir") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        console.error("Missing value for --dir.");
        process.exit(1);
      }
      values.set("dir", value);
      index += 1;
      continue;
    }

    flags.add(arg);
  }

  return { flags, values, positionals };
};

const main = async () => {
  const argv = process.argv.slice(2);
  const { flags, values, positionals } = parseArgv(argv);
  const command = positionals[0];
  const subcommand = positionals[1];
  const skipBuild = flags.has("--skip-build");
  const skipInstances = flags.has("--skip-instances");
  const nonInteractive =
    flags.has("--non-interactive") || !process.stdin.isTTY || !process.stdout.isTTY;

  configureUi({ nonInteractive });

  if (
    command === "version" ||
    argv.includes("--version") ||
    argv.includes("-v")
  ) {
    console.log(getCurrentVersion());
    process.exit(0);
  }

  if (!command || argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP.trim());
    process.exit(0);
  }

  if (command === "check-updates") {
    await checkForUpdatesNow();
    return;
  }

  await checkForUpdates();

  if (command === "init") {
    const initArgs = positionals.slice(1);
    await init({
      dirArg: values.get("dir"),
      apiKeyArg: initArgs[0],
      baseUrlArg: initArgs[1],
    });
    return;
  }

  if (command === "stores") {
    if (subcommand === "list") {
      await storesList();
      return;
    }

    if (subcommand === "set") {
      await storesSet(positionals[2]);
      return;
    }

    console.error(`Unknown subcommand: stores ${subcommand ?? "(none)"}`);
    console.log(HELP.trim());
    process.exit(1);
  }

  if (command === "pull") {
    await pull({ previewKey: positionals[1] });
    return;
  }

  if (command === "build") {
    const result = await build({ skipInstances });
    if (!result.ok) process.exit(1);
    return;
  }

  if (command === "push") {
    await push({ skipBuild, previewKey: positionals[1], skipInstances });
    return;
  }

  if (command === "dev") {
    await dev({ skipInstances });
    return;
  }

  if (command === "publish") {
    await publish({ skipBuild, previewKey: positionals[1], skipInstances });
    return;
  }

  if (command === "preview") {
    if (!subcommand) {
      await previewShow();
      return;
    }
    if (subcommand === "create") {
      await previewCreate(positionals[2]);
      return;
    }
    if (subcommand === "list") {
      await previewList();
      return;
    }
    if (subcommand === "attach") {
      await previewAttach(positionals[2]);
      return;
    }
    if (subcommand === "detach") {
      await previewDetach();
      return;
    }
    if (subcommand === "delete") {
      await previewDelete(positionals[2]);
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
