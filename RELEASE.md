# Release Process

This document describes the end-to-end steps required to cut a new release of OpenWhen.

The CI/CD pipeline (GitHub Actions) automates building, testing, packaging, and publishing a GitHub Release. A few steps that cannot be automated — primarily version bumping, changelog curation, and Chrome Web Store submission — must be performed manually.

---

## 1. Prepare the feature branch

All new work starts from a `feature/*` branch cut from `develop`:

```
git checkout develop
git pull origin develop
git checkout -b feature/<name>
```

Develop and commit your changes on `feature/<name>`. When the feature is complete, merge it back into `develop`:

```
git checkout develop
git merge --no-ff feature/<name>
git push origin develop
```

Repeat for every feature or fix that should be included in the release. Once all intended changes are on `develop`, proceed to the next step.

---

## 2. Verify the working tree is clean

Ensure there are no untracked or uncommitted files that should be part of the release:

```
git status
```

---

## 3. Run tests and linting locally

```
npm ci
npm run lint
npm test
```

All tests must pass and linting must produce no errors before tagging.

---

## 4. Update the changelog

Edit `CHANGELOG.md`:

1. Move everything under `## [Unreleased]` into a new versioned section, for example:
   ```
   ## [1.3.0] - 2026-04-15
   ```
2. Re-add an empty `## [Unreleased]` section at the top.
3. Keep language user-facing (what changed and why it matters).

Refer to [Keep a Changelog](https://keepachangelog.com/) conventions already followed in the file.

---

## 5. Bump the version number

Update the version string in **two files** so they stay in sync:

| File | Field |
|------|-------|
| `manifest.json` | `"version"` |
| `package.json` | `"version"` |

Chrome Web Store requires a four-part version (`1.2.0.1`) or three-part (`1.3.0`). Use three-part for public releases unless a patch-only hotfix is needed.

---

## 6. Commit and push to develop

```
git add CHANGELOG.md manifest.json package.json
git commit -m "chore: prepare release X.Y.Z"
git push origin develop
```

---

## 7. Merge develop into main

Open a pull request from `develop` to `main`, or merge locally:

```
git checkout main
git pull origin main
git merge --no-ff develop
git push origin main
```

CI runs lint + tests on every push (see `.github/workflows/ci.yml`). Ensure the workflow passes on `main`.

---

## 8. Create and push the version tag

The `pack-extension` workflow triggers only on tags matching `v*` pushed to `main`. Creating this tag is what initiates the automated release.

```
git tag v1.3.0
git push origin v1.3.0
```

---

## 9. Automated steps (GitHub Actions)

Once the tag is pushed, `.github/workflows/pack-extension.yml` automatically:

1. Runs lint and tests.
2. Builds `dist/openwhen-<version>.zip` via `npm run build:zip`.
3. Creates a GitHub Release named after the tag.
4. Attaches the ZIP as a release asset.
5. *(Optional, if configured)* Publishes to the Chrome Web Store via the `chrome-webstore-action` step using repository secrets.

Monitor the workflow run at: `https://github.com/<owner>/OpenWhen/actions`

---

## 10. Submit to the Chrome Web Store (manual)

Even with the publish step in CI, the Chrome Web Store review is always a manual gate. After the workflow attaches the ZIP to the GitHub Release:

1. Download `openwhen-<version>.zip` from the GitHub Release page (or use the one produced by the workflow artifact).
2. Go to the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).
3. Select the OpenWhen listing.
4. Click **Package → Upload new package** and upload the ZIP.
5. Update the store description, screenshots, and/or release notes if needed.
6. Click **Submit for review**.

> The store review typically takes 1–3 business days. Track the review status in the Developer Dashboard.

---

## 11. Post-release

After the release is live:

1. Verify the extension installs and works correctly from the store.
2. On `develop`, open the next `## [Unreleased]` section in `CHANGELOG.md` if not already present.
3. Close any GitHub issues resolved in this release.

---

## Hotfix process

For a critical fix on a released version without merging pending `develop` work:

1. Branch from the release tag: `git checkout -b feature/hotfix-X.Y.Z.1 v1.3.0`
2. Apply the fix, bump the fourth version digit (e.g. `1.3.0` → `1.3.0.1`), update CHANGELOG.
3. Commit and push the branch.
4. Merge into `main` (PR or locally) and push: `git push origin main`.
5. Tag and push: `git tag v1.3.0.1 && git push origin v1.3.0.1`.
6. Back-merge into `develop`: `git checkout develop && git merge --no-ff main && git push origin develop`.
