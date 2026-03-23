# tiendu

Official CLI for [Tiendu](https://tiendu.uy) — develop and publish storefront themes from your local machine.

Download your store's theme, edit files locally, preview changes live with a shareable URL, and publish when you're ready — all from the terminal.

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

### Buildless theme (simple)

```bash
mkdir my-theme && cd my-theme
tiendu init
tiendu pull
tiendu dev
```

### Built theme (TypeScript, npm packages, bundling)

Clone the default theme template, connect to your store, and start developing:

```bash
git clone <default-theme-repo> my-theme && cd my-theme
npm install
tiendu init
tiendu dev
```

`tiendu dev` creates a remote preview, builds your source files, uploads the output, and watches for changes. It prints a shareable URL like:

```
http://preview-xxxxxxxxxxxx.tiendu.uy/
```

The preview renders with the real Tiendu engine — same output as production.

---

## Commands

### `tiendu init`

Initializes a theme project in the current directory. Prompts for your API key, API base URL (defaults to `https://tiendu.uy`), and store ID. Saves configuration to `.cli/`.

```bash
tiendu init
```

> Add `.cli/` to your `.gitignore` if you version-control your theme — it contains your API key.

---

### `tiendu pull`

Downloads the current live theme from your store as local files.

- **Buildless themes:** extracts to the current directory.
- **Built themes** (with `tiendu.config.json`): extracts to `dist/`.

```bash
tiendu pull
```

---

### `tiendu build`

Builds a theme into its deployable output directory (`dist/`). Only available for built themes (requires `tiendu.config.json`).

```bash
tiendu build
```

The build:

1. Copies theme files (`layout/`, `templates/`, `snippets/`, `assets/`) to `dist/`
2. Discovers entry points in `src/layout/` and `src/templates/`
3. Bundles JS/TS and CSS via esbuild into `dist/assets/`

Entry naming convention:

- `src/layout/theme.ts` → `dist/assets/layout-theme.bundle.js`
- `src/templates/product.ts` → `dist/assets/template-product.bundle.js`
- `src/layout/theme.css` → `dist/assets/layout-theme.bundle.css`

---

### `tiendu dev`

The main development command.

- **Buildless themes:** watches the current directory and syncs file changes to the preview.
- **Built themes:** runs `tiendu build` in watch mode first, then watches `dist/` and syncs changes to the preview.

```bash
tiendu dev
```

- Prints the preview URL on start
- Syncs file creates, edits and deletes
- Handles both text and binary files (images, fonts, etc.)
- Press `Ctrl+C` to stop

---

### `tiendu push`

Zips and uploads files to the active preview, replacing its content entirely.

- **Buildless themes:** uploads from the current directory.
- **Built themes:** uploads from `dist/`.

```bash
tiendu push
```

---

### `tiendu publish`

Publishes the active preview to the live storefront. Visitors will see the new theme immediately. All previews for the store are removed after publishing.

```bash
tiendu publish
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
```

---

### `tiendu preview open`

Opens the active preview URL in your default browser.

```bash
tiendu preview open
```

---

## Typical workflow

### Buildless

```
tiendu init        # one time: connect to your store
tiendu pull        # one time: download the live theme

tiendu dev         # develop: edit locally, see changes live at the preview URL

tiendu publish     # when ready: push to the live storefront
```

### Built theme

```
git clone <template-repo> my-theme
cd my-theme && npm install
tiendu init        # one time: connect to your store

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

## Built themes

A **built theme** is a theme that uses `tiendu.config.json` to enable the build pipeline. It allows:

- npm packages via a local `package.json`
- TypeScript (`.ts`) for browser code
- JS bundling (multiple modules → single versioned bundle)
- CSS bundling (`@import` support)

### Project structure

```
my-theme/
├── tiendu.config.json    # marks this as a built theme
├── package.json          # npm dependencies
├── .gitignore
├── src/
│   ├── layout/
│   │   ├── theme.ts      # layout TS entry → layout-theme.bundle.js
│   │   └── theme.css     # layout CSS entry → layout-theme.bundle.css
│   ├── templates/
│   │   ├── product.ts    # template TS entry → template-product.bundle.js
│   │   └── product.css   # template CSS entry → template-product.bundle.css
│   ├── lib/              # shared modules (bundled into entries, not served)
│   └── css/              # shared CSS (imported by entry CSS)
├── layout/               # Liquid layouts
├── templates/            # Liquid templates
├── snippets/             # Liquid snippets
├── assets/               # static assets (SVGs, images, fonts)
└── dist/                 # build output (gitignored, uploaded to Tiendu)
```

### How it works

1. Source JS/TS/CSS in `src/` is bundled by esbuild into `dist/assets/`
2. Liquid files and static assets are copied from root to `dist/`
3. `dist/` is what gets uploaded — it looks like a normal Tiendu theme
4. Liquid templates reference bundles via `asset_url` (e.g. `{{ 'layout-theme.bundle.js' | asset_url | script_tag }}`)

### tiendu.config.json

Minimal config — the build conventions are hardcoded:

```json
{
  "name": "my-theme",
  "version": "1.0.0"
}
```

---

## License

MIT — see [LICENSE](LICENSE).
