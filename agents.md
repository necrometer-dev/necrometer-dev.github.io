# Necrometer — agent install rite

You are a coding agent. The user has asked you to add a **necrometer card**
to a repository.

The card is `necrometer.svg` — a committed file at the repository root,
regenerated daily by GitHub Actions. necrometer.dev hosts nothing per-user.
There is no account to create and nothing to deploy. GitHub's runners do
the carving; the file lives in *this* repo.

## Preconditions

- You are working in a GitHub repository the user can push to.
- GitHub Actions is enabled for the repo.
- `gh` is authenticated (`gh auth status`).
- The card image path in the README is relative, so `README.md` must live
  at the repository root (the default). Do not put the badge in a nested
  README unless you also change the action's `file` input and the image
  path together.

## Steps

### 0. Look around first

```sh
DEFAULT=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)
OWNER=$(gh repo view --json owner -q .owner.login)
```

- If `.github/workflows/necrometer.yml` already exists and matches the
  YAML in step 1, skip creating it. If it exists and differs, do **not**
  rewrite it unless the user asked you to; just make sure the README
  badge is present and trigger a run (step 4).
- If `README.md` already has a Necrometer badge, leave the existing line
  (don't duplicate it).

Work on `$DEFAULT`. Scheduled workflows only run from the default branch.
Do **not** put this rite on a feature branch / PR unless branch protection
blocks direct pushes — in that case open a PR, merge it, then trigger.

### 1. Create `.github/workflows/necrometer.yml` with EXACTLY this content

```yaml
name: necrometer
on:
  schedule: [{cron: "17 6 * * *"}]   # daily
  workflow_dispatch:                  # manual "run now" — does NOT run on push
permissions: { contents: write }
jobs:
  necrometer:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: necrometer-dev/necrometer-action@v1
        with:
          # GITHUB_TOKEN covers the current repo and the owner's own private
          # repos. For an org's *other* private repos, add a NECRO_TOKEN
          # secret (fine-grained PAT, org-approved).
          token: ${{ secrets.NECRO_TOKEN || secrets.GITHUB_TOKEN }}
```

Do not add a `release:` input. `@v1` is a moving tag; the action pins a
checksum-verified Seance binary itself. Do not change `runs-on` (the
binary is linux musl). Do not set `persist-credentials: false` on
checkout — the action pushes the card with those credentials.

### 2. Add this line to root `README.md`, near the title

```markdown
[![Necrometer](necrometer.svg)](https://necrometer.dev/?u=OWNER)
```

Replace `OWNER` with the login from step 0 (`$OWNER`) — the user or org
that owns the repo, not a collaborator's login, and not the repo name.

If there is no `README.md`, create a short one with a title and this badge.

The image will be broken until step 4 succeeds. That is expected. Do
**not** generate `necrometer.svg` yourself to "fill in" the gap.

### 3. Commit both files on the default branch and push

Commit `.github/workflows/necrometer.yml` and `README.md` (nothing else
this rite needs). Push to `$DEFAULT`.

### 4. Trigger the workflow and wait for the bot commit

`workflow_dispatch` does not fire just because the file landed. Run it:

```sh
gh workflow run necrometer --ref "$DEFAULT"
# the run can take a few seconds to appear
for i in 1 2 3 4 5 6 7 8; do
  id=$(gh run list --workflow necrometer --branch "$DEFAULT" --limit 1 \
        --json databaseId,status --jq '.[0].databaseId // empty')
  [ -n "$id" ] && break
  sleep 3
done
gh run watch "$id" --exit-status
git pull --ff-only origin "$DEFAULT"
```

The action commits as `necrometer[bot] <bot@necrometer.dev>` and pushes
`necrometer.svg`. Your local clone will not see the file until the pull.

## Rules

- Do **not** create, edit, or commit `necrometer.svg` by hand. The action
  generates it. A hand-made stand-in will be overwritten, and a broken
  README image until the first run is the intended state.
- Do **not** modify, wrap, or replace the action's steps. Do not download
  the Seance binary yourself in the workflow. The action fetches
  `seance-x86_64-unknown-linux-musl.tar.gz` from a pinned
  `necrometer-dev/necrometer` release tag and runs
  `sha256sum --strict --check SHA256SUMS` before executing it. If that
  check fails, **stop and report it** — do not `--no-check` or pin an
  older `release:`.
- Do **not** set the `release:` input unless the user explicitly asked
  for a specific engine tag.
- Do **not** retarget `runs-on` to windows/macos. The summoned binary is
  linux musl only.
- `necrometer.svg` goes at the repo root next to `README.md`; the
  markdown references it relatively. To put it elsewhere, change both
  the action `file:` input and the README image path.

## When the run fails

Read the log (`gh run view "$id" --log-failed`) before guessing.

| what you see | what it actually means |
|---|---|
| checksum / `sha256sum` failure | supply-chain stop. Do not bypass. Report it. |
| `no such user or org` / 404 | login is wrong, **or** the token cannot see a private org. Not always "doesn't exist". |
| 403 / rate limit | `GITHUB_TOKEN` exhausted or SAML SSO not authorized. A `NECRO_TOKEN` PAT (fine-grained, org-approved, Contents: Read on the org's repos) is the fix for org visibility. |
| `git push` rejected | default-branch protection. Allow GitHub Actions to push, or add a PAT with `contents: write` as `NECRO_TOKEN` **and** stop — tell the user, don't fight the ruleset. |
| `refusing subject` / `refusing output path` | you overrode `subject` or `file` with something that isn't a GitHub login or a workspace-relative path. Drop the override. |

A 403/404 on the GitHub API is **not** automatically "this is an org
with private repos" — that is one common cause, not the only one.

## Verify

All of these must be true after step 4:

```sh
gh run list --workflow necrometer --branch "$DEFAULT" --limit 1 \
  --json conclusion --jq '.[0].conclusion'     # success
git ls-files necrometer.svg                    # the file is tracked
git log -1 --format='%an %ae' -- necrometer.svg
# necrometer[bot] bot@necrometer.dev
```

If the SVG is missing locally, you skipped the `git pull`.

---

*engine: [necrometer-dev/necrometer](https://github.com/necrometer-dev/necrometer) · action: [necrometer-dev/necrometer-action](https://github.com/necrometer-dev/necrometer-action) · grave: [necrometer.dev](https://necrometer.dev)*
