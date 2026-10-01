# Tiendu CLI

The repository is public. Do not commit credentials, `.npmrc` tokens, or npm automation tokens.

## Release

Pushing `main` does not publish. A version tag does.

1. Set the same version in `package.json` and `package-lock.json`.
2. Commit and push to `main`.
3. Tag that commit and push the tag, for example `v0.10.2`.

GitHub Actions publishes that tag to npm with trusted publishing. There is no npm token and no local `npm publish`.

Confirm with `npm view tiendu version`.
