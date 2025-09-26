Local Git hooks (archived)
=========================

This folder contains an archived copy of the legacy `.githooks` pre-commit hook. It was
kept for reference when the repository migrated to using Husky (`.husky/`) as the
active Git hook system.

How to re-use the archived hook locally (optional):

1. Copy the files back into a `.githooks/` folder at the repo root.
2. Run:

```sh
git config core.hooksPath .githooks
```

Notes:
- The repository currently uses `.husky` (see `.git/config` hooksPath). You do not need
  to enable this archived hook unless you specifically want to switch back.
- If you want the behavior of the archived hook but keep Husky, copy the commands into
  a Husky hook script instead (e.g. `.husky/pre-commit`).
