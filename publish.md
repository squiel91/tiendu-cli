Manual publish steps:

1. Make sure `package.json` and `package-lock.json` have the new version.
2. Commit and push the release changes.
3. Create and push the matching git tag, for example:

```bash
git tag v0.9.0
git push origin main
git push origin v0.9.0
```

4. Log in to npm if needed:

```bash
npm login
```

5. Publish the package:

```bash
npm publish --access public
```

6. Verify the published version:

```bash
npm view tiendu version
```
