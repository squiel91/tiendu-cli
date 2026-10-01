Release steps:

1. Set the same version in `package.json` and `package-lock.json`.
2. Commit and push to `main`.
3. Tag that commit and push the tag:

```bash
git tag v0.10.2
git push origin main
git push origin v0.10.2
```

Pushing `main` does not publish. The `v*` tag does. GitHub Actions publishes it to npm with trusted publishing. Do not run `npm login` or `npm publish` locally, and do not commit an npm token.

4. Verify the published version:

```bash
npm view tiendu version
```
