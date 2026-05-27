# tiendu

Official CLI for [Tiendu](https://tiendu.uy) — develop and publish storefront themes from your local machine.

Download your store's theme, edit files locally, preview changes with a sharable preview URL, and publish when you're ready — all from the terminal.

---

## Requirements

- Node.js 20 or higher
- A Tiendu store
- A Tiendu API key (request one at dev@tiendu.uy)

---

## Installation

```bash
npm install -g tiendu
```

---

## Quick start

### Simple theme

```bash
mkdir my-theme && cd my-theme
tiendu init
tiendu stores list
tiendu stores set <store-id>
tiendu pull
tiendu dev
```

### Pipeline-enabled theme

Clone the default theme template, connect to your store, and start developing:

```bash
git clone <default-theme-repo> my-theme && cd my-theme
npm install
tiendu init
tiendu stores list
tiendu stores set <store-id>
tiendu dev
```

### Agent-friendly setup

```bash
tiendu init <api-key> [base-url] --non-interactive
tiendu stores list --non-interactive
tiendu stores set <store-id> --non-interactive
```

When `--non-interactive` is passed, the CLI avoids prompts and prints plain text output.

`tiendu dev` creates or attaches a remote preview, builds or stages your theme into `dist/`, runs an initial push from that prepared output, and then watches for changes. It prints a sharable preview URL like:

```
http://preview-xxxxxxxxxxxx.tiendu.uy/
```

The preview renders with the real Tiendu engine — same output as production.

When `tiendu dev` starts, it always re-syncs your current local files to the active preview before watching for changes.

By default, the CLI preserves editor-managed theme state so local development does not overwrite changes made in the theme editor. State files are `templates/*.json`, section group files like `sections/header-group.json`, and `config/settings_data.json`. Use `--override-state` when your local state JSON files should override the editor state.

---

## Commands

### `tiendu init [apiKey] [baseUrl]`

Initializes a theme project in the current directory.

- With no arguments, it runs the interactive setup wizard.
- With `apiKey` and optional `baseUrl`, it reinitializes the saved config without prompts.
- If only one store is available, it is selected automatically.
- If multiple stores are available, leave the store unset and use `tiendu stores list` plus `tiendu stores set <id>`.

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

### `tiendu stores set <storeId>`

Validates the store against the configured API key and saves it as the active store.

```bash
tiendu stores set 123
tiendu stores set 123 --non-interactive
```

---

### `tiendu pull`

Downloads the attached preview theme, or the live theme with `--live`, into `dist/` and syncs theme directories to `src/`.

- `pull` clears `dist/` first.
- The downloaded archive is then extracted into `dist/`.
- Theme directories from the download are synced into `src/`, overwriting local theme files.
- In interactive mode, the CLI asks before overwriting `src/`.
- In non-interactive mode, `src/` is overwritten without prompting.

```bash
tiendu pull
tiendu pull --live
```

---

### `tiendu build`

Builds or stages the current theme into its deployable output directory (`dist/`).

- Theme files and assets are always prepared into `dist/`.
- Optional pipeline steps are enabled through `tiendu.config.json`.
- With no config file, or with no enabled pipeline steps, `build` just stages the theme files into `dist/`.

```bash
tiendu build
tiendu build --override-state
```

- By default, `build` omits editor-managed state files from `dist/`.
- Use `--override-state` to include template JSON, section group JSON, and `config/settings_data.json` in `dist/`.
- `--include-instances` is still accepted as a deprecated alias for `--override-state`.
- `--skip-instances` is still accepted as a deprecated alias for the default preserve behavior.

The build:

1. Copies theme files from `src/layout/`, `src/templates/`, `src/sections/`, `src/blocks/`, `src/snippets/`, and `src/config/` to `dist/`
2. Flattens static files from `src/assets/` into `dist/assets/`
3. Optionally discovers script and style entry points in `src/layout/` and `src/templates/`
4. Optionally compiles JS/TS and CSS into `dist/assets/`
5. Optionally runs project PostCSS plugins for compiled CSS entries

For TypeScript source, extensionless relative imports such as `import { initHeaderCart } from '../lib/scripts/cart'` are supported and recommended.

Entry naming convention:

- `src/layout/theme.ts` → `dist/assets/layout-theme.bundle.js`
- `src/templates/product.ts` → `dist/assets/template-product.bundle.js`
- `src/layout/theme.css` → `dist/assets/layout-theme.bundle.css`

---

### `tiendu dev`

The main development command.

- Runs `tiendu build` in watch mode first.
- Watches `dist/` and syncs changes to the preview.

```bash
tiendu dev
tiendu dev --override-state
```

- By default, `dev` preserves template JSON, section group JSON, and `config/settings_data.json` on the preview so theme editor changes are not overwritten.
- Use `--override-state` to sync those state files from your local project too.
- Prints the preview URL on start
- Re-syncs the full local theme to the preview on startup
- Syncs file creates, edits and deletes
- Retries failed file sync operations up to 3 times before giving up
- Handles both text and binary files (images, fonts, etc.)
- Press `Ctrl+C` to stop

---

### `tiendu push`

Zips and uploads `dist/` to the active preview, replacing its content entirely.

- By default it runs `tiendu build` first.
- Use `--skip-build` to upload the existing `dist/` artifact without rebuilding.

```bash
tiendu push
tiendu push --skip-build
tiendu push --skip-build --non-interactive
tiendu push --override-state
```

- By default, `push` uploads code/assets while preserving editor-managed state on the preview.
- Use `--override-state` to upload local template JSON, section group JSON, and `config/settings_data.json`.

---

### `tiendu publish`

Publishes the active preview to the live storefront. Visitors will see the new theme immediately. All previews for the store are removed after publishing.

- By default it runs `tiendu build`, uploads `dist/` to the preview, and then publishes it.
- Use `--skip-build` to publish after syncing the existing `dist/` output.

```bash
tiendu publish
tiendu publish --skip-build
tiendu publish --skip-build --non-interactive
tiendu publish --override-state
```

- By default, `publish` syncs code/assets before publishing while preserving editor-managed state.
- Use `--override-state` to publish local template JSON, section group JSON, and `config/settings_data.json`.

In non-interactive mode, the publish confirmation is skipped.

### State sync defaults

You can set the default for a project in `tiendu.config.json`:

```json
{
  "sync": {
    "state": false
  }
}
```

Use `true` when local state JSON files should override editor state by default.

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

### Standard

```
tiendu init        # one time: connect to your Tiendu account
tiendu stores list # one time: see available stores
tiendu stores set  # one time: select the store to work on
tiendu pull        # one time: refresh dist/ from the live theme

tiendu dev         # develop: build/stage into dist/, sync preview updates live

tiendu publish     # when ready: push to the live storefront
```

### Pipeline-enabled

```
git clone <template-repo> my-theme
cd my-theme && npm install
tiendu init        # one time: connect to your Tiendu account
tiendu stores list # one time: see available stores
tiendu stores set  # one time: select the store to work on

tiendu dev         # develop: builds src/, watches dist/, syncs to preview

tiendu publish     # when ready: push to the live storefront
```

---

## How previews work

A **theme preview** is a remote copy of your theme hosted by Tiendu. It renders with the exact same engine as your live storefront — same Liquid templates, same data, same assets — so what you see in the preview is exactly what production will look like.

- One preview per user per store
- Preview URLs are stable and shareable
- Previews are excluded from search engines (`noindex`)
- Analytics are disabled in preview mode so test traffic doesn't pollute your metrics
- Cart and checkout work normally in previews (orders placed in a preview are real orders)

---

## Pipeline-enabled themes

All themes are staged into `dist/` before upload.

`tiendu.config.json` can optionally enable extra pipeline steps such as script compilation, style compilation, and PostCSS processing.

When pipeline steps are enabled, a theme can use:

- npm packages via a local `package.json`
- TypeScript (`.ts`) for browser code
- JS bundling (multiple modules → single versioned bundle)
- CSS bundling (`@import` support)

### Project structure

```
my-theme/
├── tiendu.config.json    # optional pipeline flags
├── package.json          # npm dependencies
├── .gitignore
├── src/
│   ├── layout/
│   │   ├── theme.liquid  # copied to dist/layout/theme.liquid
│   │   ├── theme.ts      # layout TS entry → layout-theme.bundle.js
│   │   └── theme.css     # layout CSS entry → layout-theme.bundle.css
│   ├── templates/
│   │   ├── product.liquid # copied to dist/templates/product.liquid
│   │   ├── product.ts    # template TS entry → template-product.bundle.js
│   │   └── product.css   # template CSS entry → template-product.bundle.css
│   ├── snippets/         # Liquid snippets copied to dist/snippets/
│   ├── assets/           # source assets → flattened into dist/assets/
│   ├── lib/              # shared modules (bundled into entries, not served)
│   └── css/              # shared CSS (imported by entry CSS)
└── dist/                 # staged upload artifact (gitignored, uploaded to Tiendu)
```

### How it works

1. Theme files and static assets are staged into `dist/`
2. Script entries are compiled only when `pipeline.compileScripts` is enabled
3. Style entries are compiled only when `pipeline.compileStyles` is enabled
4. PostCSS runs only when `pipeline.postcss` is enabled
5. `dist/` is what gets uploaded — it looks like a normal Tiendu theme
6. Liquid templates reference bundles and assets via `asset_url` when compiled entries are used

### Tailwind v4

Pipeline-enabled themes can use Tailwind v4 in CSS entry files when `pipeline.compileStyles` and `pipeline.postcss` are enabled.

Install it in your theme project:

```bash
npm install -D tailwindcss @tailwindcss/postcss postcss
```

Then import Tailwind from a CSS entry such as `src/layout/theme.css`:

```css
@import "tailwindcss";
```

You can either:

- rely on Tiendu CLI's automatic Tailwind detection when `@tailwindcss/postcss` is installed, or
- add a local `postcss.config.mjs` / `postcss.config.js` / `postcss.config.cjs` / `postcss.config.json`

Example `postcss.config.mjs`:

```js
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

### tiendu.config.json

Config is optional. When present, you can enable pipeline steps explicitly:

```json
{
  "pipeline": {
    "compileScripts": true,
    "compileStyles": true,
    "postcss": true
  }
}
```

Without enabled pipeline steps, the CLI still stages the theme into `dist/`, but it skips compilation and PostCSS.

With no `tiendu.config.json`, the behavior is the same as having all pipeline steps disabled.

---

## License

MIT — see [LICENSE](LICENSE).
