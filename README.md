# tiendu-cli

Official CLI for [Tiendu](https://tiendu.uy) — develop and publish storefront themes from your local machine.

Download your store's theme, edit files locally, preview changes live with a shareable URL, and publish when you're ready — all from the terminal.

---

## Requirements

- Node.js 20 or higher
- A Tiendu store
- A Tiendu API key (request one at hola@tiendu.uy)

---

## Installation

```bash
npm install -g tiendu-cli
```

---

## Quick start

```bash
# Create a working directory and enter it
mkdir my-theme && cd my-theme

# Connect to your store
tiendu init

# Download the current live theme
tiendu pull

# Start developing with live preview
tiendu dev
```

`tiendu dev` creates a remote preview of your theme, uploads your local files, watches for changes and syncs them automatically, and prints a shareable URL like:

```
http://preview-xxxxxxxxxxxx.tiendu.uy/
```

The preview renders with the real Tiendu engine — same output as production. Share the URL with your client or team before publishing.

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

Downloads the current live theme from your store as local files. Run this once to get started, or to reset your local files to the published version.

```bash
tiendu pull
```

---

### `tiendu dev`

The main development command. On first run it creates a remote preview, uploads your local files, and starts watching for changes. Every file you save is automatically synced to the preview.

```bash
tiendu dev
```

- Prints the preview URL on start
- Syncs file creates, edits and deletes
- Handles both text and binary files (images, fonts, etc.)
- Press `Ctrl+C` to stop

---

### `tiendu push`

Zips all local files (excluding dotfiles) and uploads them to the active preview, replacing its content entirely. Use this instead of `tiendu dev` if you prefer manual syncs.

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

Creates a new remote preview. Fails with a conflict error if one already exists for your account on this store — delete it first with `tiendu preview delete`.

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

```
tiendu init        # one time: connect to your store
tiendu pull        # one time: download the live theme

tiendu dev         # develop: edit locally, see changes live at the preview URL

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

## Local project structure

After `tiendu pull` your directory will look like your store's theme. The `.cli/` folder holds local CLI configuration and is never uploaded to Tiendu.

```
my-theme/
├── .cli/               # local config (API key, store ID, active preview key)
├── layout/
├── templates/
├── snippets/
├── assets/
└── ...
```

---

## License

MIT — see [LICENSE](LICENSE).
