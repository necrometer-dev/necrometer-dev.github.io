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
    env:
      # Built-in token sees your own private repos too. For an org with private
      # repos you don't own, add a NECRO_TOKEN secret (fine-grained PAT, repo read).
      GH_TOKEN: ${{ secrets.NECRO_TOKEN || secrets.GITHUB_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - name: summon the necrometer
        run: |
          cd /tmp
          REL=https://github.com/necrometer-dev/necrometer/releases/download/v0.1.0
          curl -sSLO $REL/necrometer-x86_64-unknown-linux-musl.tar.gz
          curl -sSLO $REL/SHA256SUMS
          sha256sum -c SHA256SUMS
          tar xzf necrometer-x86_64-unknown-linux-musl.tar.gz
      - run: /tmp/necrometer card "$GITHUB_REPOSITORY_OWNER" necrometer.svg
      - run: |
          git config user.name "necrometer[bot]"
          git config user.email "bot@necrometer.dev"
          git add necrometer.svg
          git diff --cached --quiet || git commit -m "necrometer: $(date +%F)"
          git push
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

- Do **not** create `necrometer.svg` by hand — the workflow generates and
  commits it. If the user wants it sooner, trigger the workflow.
- Do **not** alter the download steps — the release is pinned to `v0.1.0` and
  `sha256sum -c` must pass before the binary runs. If checksum verification
  fails, stop and report it; do not bypass it.
- If the workflow fails with a 403/404 on the GitHub API, the repo is an org
  with private repositories — tell the user to add a `NECRO_TOKEN` secret
  (fine-grained PAT, repo read on the org's repos).
- `necrometer.svg` goes at repo root next to `README.md`; the markdown
  references it relatively.

## Verify

`gh run list --workflow necrometer --limit 1` should show `success`, and
`git ls-files necrometer.svg` confirms the card is committed.

---

*the source of truth: [github.com/necrometer-dev/necrometer](https://github.com/necrometer-dev/necrometer) · read your own grave: [necrometer.dev](https://necrometer.dev)*
