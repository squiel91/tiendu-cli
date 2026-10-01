# tiendu

Official CLI for [Tiendu](https://tiendu.uy) — develop and publish storefront themes from your local machine.

Download your store's theme, edit files locally, preview changes with a sharable preview URL, and publish when you're ready — all from the terminal.

Full documentation, for people and agents: [docs.tiendu.uy](https://docs.tiendu.uy/).

When working with an agent, share [llms.txt](https://docs.tiendu.uy/llms.txt), [AI agents](https://docs.tiendu.uy/ai-agent), and [Getting started with themes](https://docs.tiendu.uy/themes/getting-started).

CLI releases are published by [publish.yml](https://github.com/squiel91/tiendu-cli/blob/main/.github/workflows/publish.yml).

---

## Requirements

- Node.js 20 or higher
- A Tiendu store
- A Tiendu API key (from **Ajustes → Desarrollo** in the merchant admin)

---

## Installation

```bash
npm install -g tiendu
```

---

## Quick start

```bash
mkdir my-theme && cd my-theme
tiendu init
tiendu stores list
tiendu stores set <store-handle>
tiendu pull
tiendu dev
```

### Agent-friendly setup

```bash
tiendu init <api-key> [base-url] --non-interactive
tiendu stores list --non-interactive
tiendu stores set <store-handle> --non-interactive
```

When `--non-interactive` is passed, the CLI avoids prompts and prints plain text output.

`tiendu dev` creates or attaches a remote preview, uploads this folder, and then watches for changes. It prints a sharable preview URL like:

```
http://preview-xxxxxxxxxxxx.tiendu.uy/
```

The preview renders with the real Tiendu engine — same output as production.

When `tiendu dev` starts, it always re-syncs your current local files to the active preview before watching for changes.

For `dev`, `push`, `pull`, and `publish`, choose how theme state is handled with `--preserve-state` or `--override-state`. Interactive runs ask when neither flag is passed. Non-interactive runs require one of the two flags. State files are `templates/*.json`, section group files like `sections/header-group.json`, and `config/settings_data.json`.

---

## Commands

### `tiendu init [apiKey] [baseUrl]`

Initializes a theme project in the current directory.

- With no arguments, it runs the interactive setup wizard.
- With `apiKey` and optional `baseUrl`, it reinitializes the saved config without prompts.
- If only one store is available, it is selected automatically.
- If multiple stores are available, leave the store unset and use `tiendu stores list` plus `tiendu stores set <handle>`.
- Writes a starter `tienduignore` when that file is missing.

```bash
tiendu init
tiendu init <api-key>
tiendu init <api-key> https://tiendu.uy --non-interactive
```

> Add `.cli/` to your `.gitignore` if you version-control your theme — it contains your API key.

---

### `tiendu stores list`

Lists all stores available for the configured API key and highlights the active one when present.

```bash
tiendu stores list
tiendu stores list --non-interactive
```

---

### `tiendu stores set <storeHandle>`

Validates the store against the configured API key and saves it as the active store. Use the store handle from `tiendu stores list`, not a numeric id.

```bash
tiendu stores set acme
tiendu stores set acme --non-interactive
```

---

### `tiendu pull`

Downloads the attached preview theme, or the live theme with `--live`, into the current folder.

- Ignored paths (see `tienduignore`) are left untouched.
- Other local files that are not in the download are removed so the folder matches the remote theme.
- In interactive mode, the CLI asks before overwriting local files and asks whether to preserve or override state when no state flag is passed.
- In non-interactive mode, pass either `--preserve-state` or `--override-state`; local files are overwritten without prompting.

```bash
tiendu pull
tiendu pull --live
tiendu pull --preserve-state
tiendu pull --override-state
```

---

### `tiendu dev`

The main development command.

- Uploads this folder to the preview, then watches for changes.

```bash
tiendu dev
tiendu dev --override-state
tiendu dev --preserve-state
```

- In interactive mode, `dev` asks whether to preserve or override theme state when no state flag is passed.
- In non-interactive mode, pass either `--preserve-state` or `--override-state`.
- Use `--preserve-state` to keep template JSON, section group JSON, and `config/settings_data.json` on the preview so theme editor changes are not overwritten.
- Use `--override-state` to sync those state files from your local project too.
- Prints the preview URL on start
- Re-syncs the full local theme to the preview on startup
- Syncs file creates, edits and deletes
- Retries failed file sync operations up to 3 times before giving up
- Handles both text and binary files (images, fonts, etc.)
- Press `Ctrl+C` to stop

---

### `tiendu push`

Zips and uploads this folder to the active preview, replacing its content entirely (except ignored files and, by default, editor-managed state).

```bash
tiendu push
tiendu push --preserve-state --non-interactive
tiendu push --override-state
```

- In interactive mode, `push` asks whether to preserve or override theme state when no state flag is passed.
- In non-interactive mode, pass either `--preserve-state` or `--override-state`.
- Use `--preserve-state` to upload code/assets while preserving editor-managed state on the preview.
- Use `--override-state` to upload local template JSON, section group JSON, and `config/settings_data.json`.

---

### `tiendu publish`

Publishes the active preview to the live storefront. Visitors will see the new theme immediately. Existing previews are kept after publishing.

- Uploads this folder to the preview, then publishes it.

```bash
tiendu publish
tiendu publish --preserve-state --non-interactive
tiendu publish --override-state
```

- In interactive mode, `publish` asks whether to preserve or override theme state when no state flag is passed.
- In non-interactive mode, pass either `--preserve-state` or `--override-state`.
- Use `--preserve-state` to sync code/assets before publishing while preserving editor-managed state.
- Use `--override-state` to publish local template JSON, section group JSON, and `config/settings_data.json`.

In non-interactive mode, the publish confirmation is skipped.

---

### `tiendu check-updates`

Checks npm for a newer `tiendu` version on demand.

```bash
tiendu check-updates
```

---

### `tiendu --version` / `tiendu -v`

Prints the current CLI version.

```bash
tiendu --version
tiendu -v
```

---

### `tiendu preview create [name]`

Creates a new remote preview.

```bash
tiendu preview create
tiendu preview create "Winter campaign"
```

---

### `tiendu preview list`

Lists all previews for your store.

```bash
tiendu preview list
```

---

### `tiendu preview delete`

Deletes the active preview (both remotely and from your local config).

```bash
tiendu preview delete
tiendu preview delete --non-interactive
```

---

### `tiendu preview open`

Opens the active preview URL in your default browser.

```bash
tiendu preview open
```

---

## Typical workflow

```
tiendu init        # one time: connect to your Tiendu account
tiendu stores list # one time: see available stores
tiendu stores set  # one time: select the store to work on
tiendu pull        # one time: download the live or preview theme

tiendu dev         # develop: watch this folder and sync preview updates live

tiendu publish     # when ready: push to the live storefront
```

---

## How previews work

A **theme preview** is a remote copy of your theme hosted by Tiendu. It renders with the exact same engine as your live storefront — same Liquid templates, same data, same assets — so what you see in the preview is exactly what production will look like.

- Preview URLs are stable and shareable
- Previews are excluded from search engines (`noindex`)
- Analytics are disabled in preview mode so test traffic doesn't pollute your metrics
- Cart and checkout work normally in previews (orders placed in a preview are real orders)

---

## Project structure

Push, pull, and `dev` sync the current folder (except ignored paths). Put theme files at the project root so `AGENTS.md` and project skills round-trip with the theme.

```
my-theme/
├── tienduignore          # extra paths to skip (gitignore syntax)
├── AGENTS.md             # optional agent notes for this theme
├── .cursor/skills/       # optional project skills
├── layout/
│   └── theme.liquid
├── templates/
│   └── product.liquid
├── sections/
├── blocks/
├── snippets/
├── config/
└── assets/
```

The CLI always skips `.cli/`, `.git/`, `node_modules/`, `.env`, `.env.*`, and `.DS_Store`, even if they are not listed in `tienduignore`.

If you still have an older `src/` + `dist/` layout, move `src/{layout,templates,sections,blocks,snippets,config,assets}` to the project root and delete `dist/`.

---

## License

MIT — see [LICENSE](LICENSE).
