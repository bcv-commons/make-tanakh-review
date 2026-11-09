# make-tanakh-review

Clause-by-clause editing of drafted Tanakh chapters, for anybody: sign in, edit, save. A save is a proposal (a commit on your own
branch + one pull request); reviewers merge proposals into the working text (`main`); the language team approves chapters into
`approved`. All text is CC0. The plan, with a log of what changed while building: [docs/PLAN.md](docs/PLAN.md).

This is the **local test**: a bare git repo per language stands in for GitHub (`src/lib/store/local-git.js`, the same methods the
GitHub App version will have), and sign-in is by name. Nothing here talks to GitHub or any other service.

## Run it

```sh
# once: Node >= 22.22 (Astro 7.4.1), pnpm via corepack
corepack pnpm install
# seed: Danish CC0 drafts cut into clause units along the Hebrew clause layout; needs MAKE_TANAKH_WORK (the work repo's toolkit)
# and ALIGNER_DATA (hebrew-clause-layout, lexeme-spine-macula.db), here from make-tanakh-grammar's env.sh
(. ../make-tanakh-grammar/env.sh && ~/sil-study/.venv/bin/python tools/prepare_chapter.py \
    --draft $MAKE_TANAKH_WORK/export/dan/dan_BSB/jos --book JOS --chapters 1 2 --out .local)
sh tools/init_local.sh dan teamlead          # the repo .local/repos/dan.git; "teamlead" is the language team
sh tools/add_chapters.sh dan                 # later: add newly seeded chapters (never overwrites one)
# review links (PLAN.md section 14): the chapters inside a CC0 corpus (here Den Frie Bibel), aligned twice, -> sidecars on main
L=$(pwd); . ../make-tanakh-grammar/env.sh; A=$BCV_COMMONS/lexeme-aligner
(cd $A/pipeline && ../.venv/bin/python $L/tools/build_links.py text --seed $L/.local/seed \
    --corpus $MAKE_TANAKH_PRIVATE/align/dfb_ot/text --out $L/.local/links/text --skip GEN:22,37,44)
$A/.venv/bin/lexeme-aligner align-text --text $L/.local/links/text --edition dan_review --iso dan --lang-name Danish \
    --data $ALIGNER_DATA --out $L/.local/links/out --runs 2 --force      # absolute paths; no Jev, nothing sent
(cd $A/pipeline && ../.venv/bin/python $L/tools/build_links.py sidecars --seed $L/.local/seed --run1 $L/.local/links/out \
    --run2 $L/.local/links/out/runs/run2 --out $L/.local/links/sidecars)
sh tools/add_links.sh dan                    # commit the sidecars to main as the bot
corepack pnpm dev                            # http://127.0.0.1:4321
corepack pnpm test                           # model, both stores, the flows on both, the browser script (jsdom), CI check
```

Start over: `rm -rf .local/repos .local/state && sh tools/init_local.sh`. Stop the dev server: `corepack pnpm astro dev stop`.

## Try it

1. Sign in (top right) as any name, tick "my edits are CC0" (asked once).
2. The start page is the editor (the chapter you had open last; menus for language, book and chapter at the top). Each box is a clause of the translation next to its Hebrew clause (glosses under the words; dotted = a content
   word the draft did not render). Type `#` to split a clause where the cursor is, `%` first to join with the clause before, `%`
   last to join with the one after (or ✂ ⤒ ⤓). Ctrl+S saves: your proposal opens.
3. As another name: Review → "Become a reviewer" → "Merge into the working text".
4. As `teamlead`: Review → "Approve JOS 1".
5. A conflict: two people change the same verse; the first is merged; the second gets "waits for … to choose", opens the chapter,
   "Bring in the working text", picks per verse, and the reviewer merges.

## Files

| | |
|---|---|
| `docs/PLAN.md` | the plan and its log |
| `tools/prepare_chapter.py` | draft + alignment + Hebrew clause layout -> clause units (`.local/seed`) and the Hebrew side (`.local/hebrew`) |
| `tools/build_links.py`, `add_links.sh` | the review links: alignment text, sidecars from two runs, committed to main |
| `tools/init_local.sh` | the local language repo (README, LICENSE CC0, CONTRIBUTING, chapters on `main` and `approved`) and roles |
| `template/FORMAT.md` | the chapter format of the language repos: `.md` text plus `.units`, `.notes`, `.align` sidecars |
| `src/lib/format.js` | that format: parsers and writers of the four files, the text hash input, the tokeniser (browser and server) |
| `src/lib/vendor/tokenize.js` | the standard tokeniser, vendored unchanged from compact-alignments (CC0; `vendor/README.md`) |
| `src/lib/chapter.js` | a chapter on the server: units cut from the text, files built back with hashes, merge by verse |
| `src/lib/align.js` | projection of links and note anchors across a text edit (PLAN.md 16.2, first step) |
| `src/lib/poetry.js` | poetry lines (`.tanakh/poetry/`) placed through `.units` and `.align` (browser and server) |
| `src/lib/alternatives.js` | the other drafts of a chapter (`.tanakh/alternatives/`, FORMAT.md section 9): their words under each clause, and the agreement shading computed from the current text |
| `src/lib/renderings.js` | the glosses under the Hebrew words: the draft's own rendering (`.align`) and the language's commonest renderings (`.tanakh/glosses.json`, FORMAT.md section 8; else lexeme-alignments' `top.json` at the revision pinned in `config.js`, cached in `$MTR_DATA/lexeme-glosses/`) |
| `tools/fetch_index.mjs` | compact-alignments' source index into `$MTR_DATA/index` (the `.align` ordinals and their lexemes, for the poetry lines and the glosses) |
| `template/.github/` | the language repos' CI: `workflows/validate.yml` runs `check/validate.mjs` (FORMAT.md section 6) |
| `src/lib/units.js` | the clause-unit model: `#` / `%`, labels, changed verses (browser and server) |
| `src/lib/store/local-git.js` | the store: git plumbing, compare-and-swap refs, pull request records |
| `src/lib/store/github.js` | the same store on GitHub's API (two tokens, forks, the App's token); `test/github-mock.js` is its mock GitHub |
| `tools/github_live_test.mjs` | the live test: `setup <owner>/<repo>` makes a test App (manifest, three clicks), `run` runs the flows against a throw-away repo, `dev` runs the app itself against it (port 4398) |
| `src/lib/service.js` | the flows: load, save, proposal, merge, bring in main, close, reviewer request, approve |
| `src/lib/session.js`, `oauth.js` | the sealed session cookie, the CC0 agreement; GitHub sign-in (local: sign-in by name) |
| `src/lib/http.js`, `config.js` | route helpers; settings (`MTR_DATA`, `MTR_GITHUB_*`), the language list, the store per user |
| `src/pages/` | home, editor (`edit/[lang]/[book]/[ch]`), review (`review/[lang]`), `api/*` |
| `src/client/editor.js` | the editor in the browser |

`.local/` (git-ignored) holds the seed, the Hebrew side, the repos, the state and the session secret.

## From the local test to GitHub

`src/lib/store/github.js` is `GitHubStore`: the methods of `LocalGitStore` (async; the flows in `service.js` await every store call),
one instance per request for the signed-in user. It is tested against a mock GitHub (`test/github-mock.js`), not yet against
GitHub itself. The app uses it when the five `MTR_GITHUB_*` settings are set (`.env.example`); without them it is the local test.

| LocalGitStore | GitHubStore |
|---|---|
| `readFile`, `listFiles` | `GET /git/ref/heads/{b}`, then the commit's tree read whole (`GET /git/trees/{sha}?recursive=1`) and `GET /git/blobs/{sha}`; trees and blobs are cached across requests (version = the blob sha) |
| `writeFiles(branch, files, {expect})` | `POST /git/trees` (on the head's tree), `POST /git/commits`, `PATCH /git/refs/heads/{b}` without force: a branch that moved is refused |
| `commitMerge(into, from, files)` | the same with two parents; a fork's head is the second parent, so GitHub marks the PR merged by itself |
| `setBranch`, `branchHead`, `mergeBase`, `changedFiles` | `POST/PATCH /git/refs`, `GET /git/ref`, `GET /compare/{a}...{b}` (merge base), the two trees compared |
| `createPR`, `updatePR`, `listPRs` | `POST/GET /pulls` (open ones into main, the last ten closed), the `conflict` label, `PATCH` to close, a comment naming who merged or closed |
| `roles()`, `setRoles()` | `roles.json` on main, written by the App |

Tokens (PLAN.md 15.2 point 2): the user's own token opens their pull request (with the CC0 line in its body) and, if they can push
to the language repo, writes their `edit/<login>` branch; the App's installation token (`appTokens`: minted from the App's private
key, kept until near expiry) writes `main`, `approved`, `roles.json` and the branches of users without push access (the person as
co-author: an App's user token reaches only repos the App is installed on, so not a contributor's fork), and labels, closes and
comments on pull requests. A pull request made on github.com from a fork is read and merged like the others.

**Sign-in with GitHub** (`src/lib/oauth.js`, `src/pages/auth/callback.js`): the GitHub App's user authorisation, identity only.
The session cookie is sealed (AES-256-GCM under `MTR_SESSION_SECRET`) and holds the login and the user's token (refreshed when it
expires); the CC0 tick is remembered on the browser for that login and stated in the user's pull requests. The language list is
the repositories the App is installed on with the topic `global-tanakh`, public ones only (`MTR_GITHUB_PRIVATE=1` lists private ones too, for a test). What to set up is in PLAN.md section 12.
