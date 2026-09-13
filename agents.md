# Necrometer — agent install rite

You are a coding agent. The user has asked you to add a **necrometer card** to
a repository. The card is `necrometer.svg` — a committed file regenerated daily
by a GitHub Actions workflow. Nothing is hosted by necrometer.dev; GitHub's own
compute does the work, so there is nothing to deploy and no account to create.

## Steps

### 1. Create `.github/workflows/necrometer.yml` with EXACTLY this content

```yaml
name: necrometer
on:
  schedule: [{cron: "17 6 * * *"}]   # daily
  workflow_dispatch:                  # manual "run now" — also runs on first push
permissions: { contents: write }
jobs:
  necrometer:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: necrometer-dev/necrometer-action@v1
        with:
          # GITHUB_TOKEN covers your own private repos. For an org with private
          # repos you don't own, add a NECRO_TOKEN secret (fine-grained PAT).
          token: ${{ secrets.NECRO_TOKEN || secrets.GITHUB_TOKEN }}
```

### 2. Add this line to the repository's `README.md`, just under the title

```markdown
[![Necrometer](necrometer.svg)](https://necrometer.dev/?u=OWNER)
```

Replace `OWNER` with the repository owner's GitHub login
(`gh repo view --json owner -q .owner.login`).

### 3. Commit both files on the default branch and push

### 4. Trigger the workflow once so the card appears immediately

```sh
gh workflow run necrometer
```

(or the Actions tab → necrometer → Run workflow). It re-carves daily after that.

## Rules

- Do **not** create `necrometer.svg` by hand — the action generates and
  commits it. If the user wants it sooner, trigger the workflow.
- Do **not** modify or replace the action's steps —
  `necrometer-dev/necrometer-action` summons a release binary pinned to
  `v0.2.1` and runs `sha256sum -c` before executing it. Tampering with that is
  a supply-chain downgrade; if checksum verification fails in a run, stop and
  report it.
- If the run fails with a 403/404 on the GitHub API, the repo belongs to an
  org with private repositories — tell the user to add a `NECRO_TOKEN` secret
  (fine-grained PAT, repo read on the org's repos).
- `necrometer.svg` goes at repo root next to `README.md`; the markdown
  references it relatively.

## Verify

`gh run list --workflow necrometer --limit 1` should show `success`, and
`git ls-files necrometer.svg` confirms the card is committed.

---

*the source of truth: [github.com/necrometer-dev/necrometer](https://github.com/necrometer-dev/necrometer) · the action: [necrometer-dev/necrometer-action](https://github.com/necrometer-dev/necrometer-action) · read your own grave: [necrometer.dev](https://necrometer.dev)*
