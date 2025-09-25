Local Git hooks
================

This folder contains a small `pre-commit` hook that runs tests locally before allowing a commit.

Enable hooks locally (one-time per clone):

```sh
git config core.hooksPath .githooks
```

Notes:
- CI (GitHub Actions) also runs the same test suite on push and pull requests.
- If you need to bypass the pre-commit checks temporarily, use `git commit --no-verify`.
