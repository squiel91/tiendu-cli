# tiendu

Official CLI for [Tiendu](https://tiendu.uy) — develop and publish storefront themes from your local machine.

Download your store's theme, edit files locally, preview changes live with a local auto-reloading URL plus a sharable preview URL, and publish when you're ready — all from the terminal.

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

`tiendu dev` creates a remote preview, builds your source files, runs an initial push from the prepared output, and then watches for changes. It prints a local live-preview URL first, plus a sharable preview URL like:

```
http://preview-xxxxxxxxxxxx.tiendu.uy/
```

The preview renders with the real Tiendu engine — same output as production.

When `tiendu dev` starts, it always re-syncs your current local files to the active preview before watching for changes.
It also starts a local live-preview URL that proxies the preview and auto-reloads after successful syncs.

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

1. Copies theme files from `src/layout/`, `src/templates/`, and `src/snippets/` to `dist/`
2. Flattens static files from `src/assets/` into `dist/assets/`
3. Discovers entry points in `src/layout/` and `src/templates/`
4. Bundles JS/TS and CSS into `dist/assets/`
5. Runs project PostCSS plugins for CSS entries when available (for example Tailwind v4)

For TypeScript source, extensionless relative imports such as `import { initHeaderCart } from '../lib/scripts/cart'` are supported and recommended.

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
- Re-syncs the full local theme to the preview on startup
- Syncs file creates, edits and deletes
- Retries failed file sync operations up to 3 times before giving up
- Starts a local live-preview URL on `localhost` that refreshes after successful uploads
- Handles both text and binary files (images, fonts, etc.)
- Press `Ctrl+C` to stop

---

### `tiendu push`

Zips and uploads files to the active preview, replacing its content entirely.

- **Buildless themes:** uploads from the current directory.
- **Built themes:** runs `tiendu build` first, then uploads from `dist/`.

```bash
tiendu push
tiendu push --skip-build
```

Use `--skip-build` to upload the existing `dist/` output without rebuilding.

---

### `tiendu publish`

Publishes the active preview to the live storefront. Visitors will see the new theme immediately. All previews for the store are removed after publishing.

- **Buildless themes:** publishes the active preview as-is.
- **Built themes:** builds the theme, uploads the latest `dist/` output to the preview, then publishes it.

```bash
tiendu publish
tiendu publish --skip-build
```

Use `--skip-build` to publish after uploading the existing `dist/` output without rebuilding.

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
└── dist/                 # build output (gitignored, uploaded to Tiendu)
```

### How it works

1. Source assets in `src/assets/` are flattened into `dist/assets/` (`payment-methods/visa.svg` becomes `payment-methods___visa.svg`)
2. Source JS/TS/CSS in `src/` is bundled by esbuild into `dist/assets/`
3. CSS entries also run through your local PostCSS pipeline when configured
4. Liquid files are copied from `src/` to `dist/`
5. `dist/` is what gets uploaded — it looks like a normal Tiendu theme
6. Liquid templates reference bundles and assets via `asset_url` (e.g. `{{ 'layout-theme.bundle.js' | asset_url | script_tag }}` or `{{ 'payment-methods/visa.svg' | asset_url }}`)

### Tailwind v4

Built themes can use Tailwind v4 in CSS entry files.

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
