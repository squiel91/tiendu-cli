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
import { resolveOverrideState } from "../lib/config.mjs";
import { configureUi } from "../lib/ui.mjs";

const HELP = `
tiendu — Tiendu theme development CLI

Usage:
  tiendu init [apiKey] [baseUrl] [--api-key <key>] [--base-url <url>] [--preview-key <key>] [--dir <path>]
                               Initialize interactively, or reset config with direct credentials
  tiendu stores list           List stores available for the configured API key
  tiendu stores set <storeId>  Select the active store
  tiendu pull [previewKey] [--live]
                                Download the attached preview or a specific preview into dist/ and src/
  tiendu build [--override-state]
                               Build or stage the current theme into dist/
  tiendu push [previewKey] [--skip-build] [--override-state]
                               Upload dist/ to the attached or specified preview
  tiendu dev [--override-state]
                               Start dev mode: auto-sync changes to a live preview URL
  tiendu publish [previewKey] [--skip-build] [--override-state]
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
  --api-key <key>              Provide an API key to tiendu init (alternative to positional arg)
  --base-url <url>             Provide a base URL to tiendu init (alternative to positional arg)
  --preview-key <key>          Attach a preview during tiendu init
  --live                       Force tiendu pull to download the live theme
  --skip-build                 Reuse the existing dist/ output for push or publish
  --override-state             Sync local theme state JSON and override editor state
  --preserve-state             Preserve editor-managed state JSON (default)
  --include-instances          Deprecated alias for --override-state
  --skip-instances             Deprecated alias for --preserve-state
  --help, -h                   Show this help message
  --version, -v                Show the current CLI version

Init behavior:
  tiendu init                  Interactive setup wizard
  tiendu init <apiKey>         Reset saved config and connect using the default base URL
  tiendu init <apiKey> <url>   Reset saved config and connect using a custom base URL
  tiendu init --api-key <key> --base-url <url>   Using flags instead of positional args
  tiendu init --preview-key <key>                Attach a preview directly
  The default base URL points to the Tiendu platform and rarely needs to change.
  If exactly one store is available, it is selected automatically.
  If multiple stores are available, the interactive init will let you choose one.
  After selecting a store, you can also create or attach a preview.

Agent-friendly setup:
  tiendu init <apiKey> [baseUrl] --non-interactive
  tiendu init --api-key <key> --base-url <url> --non-interactive
  tiendu stores list --non-interactive
  tiendu stores set <id> --non-interactive
  tiendu pull --non-interactive
  tiendu push --non-interactive
  tiendu publish --non-interactive

Push and pull behavior:
  build always prepares dist/ as the local deploy artifact.
  push sends a zip of dist/ to the target preview.
  pull downloads from the attached preview by default, or the live theme with --live.
  pull also syncs downloaded theme directories to src/.

Pipeline behavior:
  tiendu.config.json can enable optional pipeline steps.
  pipeline.compileScripts enables JS/TS entry compilation.
  pipeline.compileStyles enables CSS entry compilation.
  pipeline.postcss enables PostCSS for compiled style entries.
  With no config file, or with no enabled pipeline steps, build just stages theme files into dist/.

Theme state behavior:
  By default, the CLI preserves editor-managed state files: templates/*.json,
  sections/*.json, and config/settings_data.json.
  Use --override-state when your local state JSON should overwrite preview/editor state.
  In tiendu.config.json, set { "sync": { "state": true } } to make local
  state JSON the project default, or false to keep the safe default explicit.

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

    if (arg === "--dir" || arg === "--api-key" || arg === "--base-url" || arg === "--preview-key") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        console.error(`Missing value for ${arg}.`);
        process.exit(1);
      }
      values.set(arg.slice(2), value);
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
  const overrideStateFlag =
    flags.has("--override-state") || flags.has("--include-instances");
  const preserveStateFlag =
    flags.has("--preserve-state") ||
    flags.has("--preserve-instances") ||
    flags.has("--skip-instances");
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
      apiKeyArg: values.get("api-key") ?? initArgs[0],
      baseUrlArg: values.get("base-url") ?? initArgs[1],
      previewKeyArg: values.get("preview-key"),
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
    await pull({ previewKey: positionals[1], forceLive: flags.has("--live") });
    return;
  }

  if (command === "build") {
    const overrideState = await resolveOverrideState({
      overrideStateFlag,
      preserveStateFlag,
    });
    const result = await build({ overrideState });
    if (!result.ok) process.exit(1);
    return;
  }

  if (command === "push") {
    const overrideState = await resolveOverrideState({
      overrideStateFlag,
      preserveStateFlag,
    });
    await push({ skipBuild, previewKey: positionals[1], overrideState });
    return;
  }

  if (command === "dev") {
    const overrideState = await resolveOverrideState({
      overrideStateFlag,
      preserveStateFlag,
    });
    await dev({ overrideState });
    return;
  }

  if (command === "publish") {
    const overrideState = await resolveOverrideState({
      overrideStateFlag,
      preserveStateFlag,
    });
    await publish({ skipBuild, previewKey: positionals[1], overrideState });
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
