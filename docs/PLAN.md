# make-tanakh-review: plan

Written 2026-10-31 before building. The user gave trust to build to it while away. Changes made while building go to the log at
the end, so the plan stays the record of what was intended and what was done.

## 1. Goal

A web editor where anybody can improve a drafted Tanakh chapter, clause by clause, without knowing git:

- **edit:** anyone signed in edits; the edit is a proposal (a commit on their own branch + a pull request);
- **review:** reviewers (self-serve: anyone who asks) see the proposals clause by clause and merge them into the working text;
- **approve:** the language team approves a chapter of the working text; that is the text that counts as the team's.

Reviewing is one part of editing: the same screen shows the draft, the Hebrew, the review flags and the proposals.

All published text is **CC0** (the user's standing decision, 2026-10-31): one licence per language repo, contributors agree at
first sign-in, approval changes a chapter's status, never its licence. Drafting with protected inputs stays private and never
reaches this editor (only the CC0 drafts are published into the language repos).

## 2. Scope of this first build (a local test)

The user's request: "build it out with an early design to be able to edit clause by clause following the Macula/UHB", with `#`
to split a clause and `%` to join (as first letter: join with the one before; as last letter: join with the one after), or buttons
for the same; everything under the git-ignored `make-tanakh-review/`; nothing set up on GitHub yet.

So this build:

1. runs locally with `pnpm dev` (Astro, server output, Netlify adapter: the same code deploys to Netlify later);
2. imitates GitHub with a **local git repo per language** and a **store class** that does exactly what the GitHub App will do
   (read a file on a branch, write a commit to a per-user branch with an expected-version check, open / list / merge pull requests,
   approve a chapter); the GitHub version of the class is the one part to write when the App exists;
3. imitates sign-in with a name form (no password; GitHub OAuth later), with the CC0 agreement at first sign-in;
4. uses the **Danish CC0 drafts of Joshua 1 and 2** (work repo `export/dan/dan_BSB/jos`, CC0 per its project.yaml) cut into clause
   units along the **Hebrew clause layout** (bcv-commons hebrew-clause-layout, built from MACULA Hebrew / WLC); the cuts are placed
   by the drafts' own alignment (`jos00N.align`).

Not in this build: real GitHub, comments threads, notes, audio, offline use, cross-verse joins, reordering of clauses, BSB helper
text, rebuilding the alignment after edits.

## 3. Architecture

```
Browser (Astro pages + one client script)
   │  GET pages (no sign-in needed to read)        POST /api/* (signed-in; cookie)
   ▼
Astro server routes (Netlify Functions in production, Node locally)
   │  session (signed cookie: login only)          roles (who reviews, who approves)
   ▼
Store interface ──────── LocalGitStore (this build: bare git repo per language, git plumbing; PR records in a JSON file)
                   └──── GitHubStore (later: GitHub App installation token; Contents / Git Data / Pulls API)
```

The pankosmia design, minus pankosmia: identity from GitHub, writes by a GitHub App on behalf of the user, one branch per user,
one pull request per branch, review = merge. Differences, on purpose:

- **One service**, not a static site + a separate backend: Astro's server routes are the backend; the App key lives in Netlify's
  environment. No per-language clone cache: reads go through the store (GitHub's API in production, cached per request).
- **Our own merge**, clause-aware (section 6), not git's line merge: a conflict is shown as two versions of one verse's clauses and
  settled with one click, in the editor.
- **Three tiers** (user's debate 2026-10-31): `main` is the working text that reviewers merge into; `approved` is the team's text,
  written only by the approve action of a team member. The self-serve reviewer grant is safe because merging into `main` does not
  make a text official.

## 4. Data

### 4.1 The language repo (CC0, one per language; here `.local/repos/<lang>.git`)

```
README.md            what this is; how to edit (link to the editor)
LICENSE              CC0 1.0
CONTRIBUTING.md      "edits are given under CC0"
<BOOK>/<BOOK>_<CCC>.md    one chapter, one verse per line, + .align/.units/.notes/.layout sidecars (FORMAT.md; decided 2026-11-02, replaces the .tsv below)
```

A chapter file, one clause unit per line, tab-separated, diff-friendly (a pull request shows which clause changed):

```
# JOS 1 · make-tanakh-review clause units · CC0 · columns: verse, Hebrew clauses, text
1:1	060010010011	Efter at HERRENS tjener Moses var død,
1:1	060010010051	sagde HERREN til Josva, Nuns søn, Moses' medhjælper:
1:2	060010020011+060010020031	>>Min tjener Moses er død.
1:3	060010030011.1	...
1:3	060010030011.2	...
```

- `Hebrew clauses` names the Hebrew clause(s) the unit renders by the layout's `clause_key` (the key of the clause's first
  morpheme): `A+B` = a unit that renders two joined clauses; `A.1`, `A.2` = the parts of one clause that the translator split.
- Units are in the target's reading order within the verse; the verse text is the units joined by a space.
- Only keys go in the repo, never Hebrew text: the Hebrew is shown by the editor from the layout (credited) and keys are identifiers.

### 4.2 Read-only side data (prepared once, `.local/hebrew/<BOOK>/<CCC>.json`)

Per verse the Hebrew clauses in order: key, kind, rule, and per word (morphemes grouped by word): surface, English gloss
(MACULA, CC BY 4.0), whether it is a content word, and whether the seeded draft linked it to a target word (the review flag).
Built by `tools/prepare_chapter.py` from `$ALIGNER_DATA` (hebrew-clause-layout, lexeme-spine-macula.db) and the work repo's draft.
Flags are from the draft as seeded; edits don't recompute them in this build (a later step: re-align a chapter after merges).

### 4.3 Local state (`.local/state/`)

`prs.json` (pull requests: number, author, branch, status open / merged / closed / conflict, created, merged_by), `roles.json` per
language (`reviewers`: self-serve list; `team`: set by hand, as CODEOWNERS will be), `users.json` (login, CC0 agreement date). On
GitHub these are: real pull requests, repo collaborators, a CODEOWNERS file / team, and the agreement as a line in the first PR.

## 5. Seeding: cutting a draft into clause units (`tools/prepare_chapter.py`)

Per verse: the Hebrew clauses (layout rows of the verse, by `seg`), each a set of morpheme keys; the draft's tokens (the toolkit's
`tokenize`) and links (`.align`: Hebrew content word ord -> token positions; ord -> key by the toolkit's index). Each linked token
votes for the clause of its Hebrew word. A dynamic programme cuts the token sequence into one contiguous group per clause, in
order, minimising the linked tokens that land outside their clause's group. A clause with no tokens joins the next unit (or the
previous at the verse end), so the seed may already contain `A+B` units. Cuts go at the whitespace before a group's first token,
so punctuation stays with the word before and opening quote marks with the word after. Check: joining the units restores the
verse text exactly (every verse; a failure keeps the verse as one unit and is counted).

## 6. Editing model (`src/lib/units.js`, shared by browser and server)

- **Split `#`**: typing `#` in a unit's text (or the button "split at cursor") cuts the unit at that point. A unit that renders
  several joined clauses `A+B+C` gives its first clause to the first part and the rest to the second; a unit of one clause `A`
  becomes `A.1` and `A.2` (an `A.2` split again gives `A.2`, `A.3`: parts renumbered).
- **Join `%`**: a unit whose text begins with `%` joins the unit before it; one that ends with `%` joins the unit after it (or the
  buttons). The texts are joined with a space; the clause lists are merged (parts of one clause fold back: `A.1`+`A.2` -> `A`).
- Joins stay within a verse (a join across a verse boundary is refused with a message). A literal `#` or `%` is typed as `\#`, `\%`.
- **Save** sends the whole chapter (units) and the version it was loaded from; the server checks it, writes one commit to the
  user's branch and opens the pull request if there is none. Ctrl+S saves. A stale version (saved elsewhere meanwhile) is refused
  with a reload prompt; nothing is lost silently.
- **Three-way merge by verse** (`merge(base, ours, theirs)`): a verse changed on one side only takes that side; a verse changed on
  both sides to different units is a conflict. Used for merging a PR into `main` and for "update my branch from main".

## 7. Flows (server routes)

| route | who | what |
|---|---|---|
| `GET /` | anyone | languages, chapters, sign-in state |
| `GET /edit/<lang>/<BOOK>/<ch>` | anyone (read) / signed-in (edit) | the editor: per verse, Hebrew clauses next to the target units; signed in: the user's branch if it has an open PR, else main; changed units marked against main |
| `GET /review/<lang>` | anyone (read) / reviewers (merge) / team (approve) | open PRs with clause-level diffs; chapters where main differs from approved |
| `POST /api/signin`, `/api/signout` | anyone | mock sign-in (login + CC0 agreement); GitHub OAuth later |
| `POST /api/save` | signed-in, agreed CC0 | commit to `edit/<login>`, open PR |
| `POST /api/update-branch` | PR author | merge main into the branch by verse; conflicts returned for choice |
| `POST /api/resolve` | PR author | the user's choice per conflicting verse, committed |
| `POST /api/request-reviewer` | signed-in | self-serve reviewer grant (mirrors the issue + workflow) |
| `POST /api/merge` | reviewer | merge a PR into main by verse; a conflict marks the PR, the author settles it |
| `POST /api/close` | reviewer or author | close a PR unmerged |
| `POST /api/approve` | team | copy a chapter from main to approved, one commit |

The user branch: created from main at the first save; when the user has no open PR, the next save resets it to main first (as
pankosmia does), so merged work never comes back as a second proposal.

## 8. The store interface (`src/lib/store/`)

```
branchHead(branch) -> sha | null
readFile(branch, path) -> {text, version} | null      version = blob id (GitHub: the file's sha)
listFiles(branch, prefix) -> [path]
writeFile(branch, path, text, {message, coAuthor, expectVersion}) -> {commit}   refuses a stale expectVersion
ensureBranch(branch, from), resetBranch(branch, to)
commitMerge(into, from, files, message) -> commit     two parents: our merged content, git history kept
mergeBase(a, b) -> sha
listPRs(), createPR(...), updatePR(n, fields)
```

LocalGitStore implements it with git plumbing on a bare repo (`hash-object`, a temporary index, `write-tree`, `commit-tree`,
`update-ref` with the old value as the compare-and-swap), so it behaves like GitHub's API: no working tree, atomic ref updates.
GitHubStore (later) maps each call to the REST API with the App's installation token.

## 9. Security notes for the GitHub version (not built now)

- The App key and client secret only in the server's environment; the browser holds only a signed, http-only session cookie.
- Branch rules on `main` (PR required, no force-push, no deletion) and on `approved` (only the App, on a team member's action).
- No secrets in language repos (write collaborators can change Actions workflows).
- Rate limits: one commit per save; the editor saves on demand, not per keystroke.

## 10. Tests

- `test/units.test.js` (node --test): split / join rules, escapes, the three-way merge, the TSV round trip.
- `test/store.test.js`: a temporary bare repo: write, stale-version refusal, branch reset, merge commit with two parents.
- A scripted run through the HTTP routes (two users, a reviewer, a conflict, an approval) against `pnpm dev`, logged in the README.

## 11. Steps

1. this plan
2. `tools/prepare_chapter.py` + seeding JOS 1-2 into `.local/repos/dan.git` (`tools/init_local.sh`)
3. `units.js` + tests
4. LocalGitStore + tests
5. session, roles, PR logic (`src/lib/`)
6. API routes
7. pages: home, editor (client script), review
8. scripted run; README; report to the user (what works, what is next, what GitHub setup is needed)

## 12. What the user needs to set up later (GitHub)

A GitHub organisation for the CC0 language repos; a GitHub App installed on it (contents, pull requests, metadata: read/write;
user authorisation without scopes; App id, private key, client id / secret); a Netlify site with those as environment variables;
branch rules on `main` and `approved`; a reviewer-request issue form if the self-serve grant should also work on github.com.

In detail (2026-11-03, as the code expects it):
- **The App:** permissions Contents read/write, Pull requests read/write, Metadata read; callback URL
  `https://<site>/auth/callback`; "Expire user authorization tokens" on (the app refreshes them); installed on the organisation.
- **The language repos:** public, topic `global-tanakh` (the language list), `roles.json` on main, branches `main` and `approved`.
- **The Netlify site:** `MTR_GITHUB_APP_ID`, `MTR_GITHUB_PRIVATE_KEY`, `MTR_GITHUB_CLIENT_ID`, `MTR_GITHUB_CLIENT_SECRET`,
  `MTR_GITHUB_ORG`, `MTR_SESSION_SECRET` (`.env.example`).
- **Branches:** every `edit/<login>` branch lives in the language repo (the log, 2026-11-04); leave `edit/*` unprotected.

## Log (changes while building)

- **Astro 7.4.1, not 7.4.4.** 7.4.2 and later need Node >= 22.23.4; this box has 22.22.1. 7.4.1 (Node >= 22.22) is pinned; the
  Netlify adapter 8.2.10 takes Astro ^7. Move up when Node is updated (Netlify's build image can set its own Node version).
- **Telemetry off** in the `dev` and `build` scripts (`ASTRO_TELEMETRY_DISABLED=1`): nothing leaves the box in the local test.
- **Split of a joined unit** (section 6): the clauses go by where the cut falls (a unit of 3 clauses cut at 2/3 of its text gives 2
  and 1), not always "first clause to the first part"; at least one clause each side. Cutting at the boundary of A+B still gives A | B.
- **Part numbers are derived, not stored in memory**: a unit holds the list of its Hebrew clauses; `A.1`, `A.2` are written when one
  clause is rendered by several units of its verse. Splits and joins never renumber by hand; joining all parts gives `A` again.
- **A browser-script test** with jsdom (dev dependency 26.1.0; no browser on this box): typing `#` / `%`, the buttons, save.
- **A save of unchanged text** answers "nothing changed" without a commit.
- **Seed result** (JOS 1-2): 42 verses, 196 units, 21 of them joined clauses (A+B: a Hebrew clause the draft rendered no word of on
  its own); every verse passed the join check (the units joined restore the verse exactly).
- **Checked (2026-10-31):** 17 tests pass (`pnpm test`); `pnpm build` makes the Netlify function; the HTTP run: sign-in with and
  without the CC0 agreement, save -> PR #1, merge refused before the reviewer grant, self-serve grant, merge (bot commit with the
  reviewer as co-author), approval by `teamlead`, a second proposal shown on the review page with its clause diff.
- **Not done in this build** (as planned): GitHubStore, comments, notes, re-aligning after merges (the review flags are the seed's),
  cross-verse joins, moving a clause within a verse, BSB helper text.
- **The editor is the start page (user, 2026-10-31):** `/` opens the chapter last opened (cookie `mtr_last`), else the first chapter
  in Bible order; the top bar has language / book / chapter menus, ‹ › for the previous / next chapter and a Review link with the
  number of open proposals. The former home page (a list of languages and chapters) is gone; `/edit/<lang>` opens its first chapter.
- **Genesis seeded:** the Danish drafts of Genesis start at chapter 20 (no draft of GEN 1-19 in the project); GEN 20-50 seeded
  except the lab's held-out chapters 22, 37, 44 and chapter 28 (no draft file): 27 chapters, 3,161 units, every verse joined back
  exactly. `tools/add_chapters.sh` adds newly seeded chapters to an existing repo (main and approved) and never overwrites a chapter.
- **The published chapter format in the editor (2026-11-02, handover steps 1-3; 16.8 point 2):** a chapter is read as `.md` +
  `.units` (+ `.notes`, `.align`) and saved as one commit of the files that changed, every `# text` hash recomputed
  (`src/lib/format.js`, `chapter.js`). The tokeniser is not ported: `src/lib/vendor/tokenize.js` is the compact-alignments
  reference, unchanged, **v3** (the dataset manifest's `tokenizer_version`; v2 and v3 differ for Myanmar script only). The text
  hash: `c:v:text`, integers, numeric order, newline-joined, no trailing newline. A unit's text runs from after the last white space
  before its first token (opening `>>` goes with it) to the next unit; joined with one space the units give the verse back.
  A text edit projects that verse's `.align` positions and `.notes` anchors across a token diff (`src/lib/align.js`, 16.2 step 1)
  and sets its profile to `s`; a re-cut only rewrites `.units` (header `edited`). Merges go verse by verse over all four files.
  Verified on `.local/repos/dan-v2.git`: all 299 chapters hash, round-trip byte for byte, and build back unchanged from the
  editor's units (8,237 verses, 33,432 units, no scattered ranges, every token in one unit); an HTTP save on a copy gave a commit
  whose sidecars all hash. Word-level link hover (`links/1`) is retired with `links.js`: per-word statuses need the MACULA
  ordinals of the `.align` rows (16.3).
- **CI validation in the template (2026-11-02, handover step 4; 16.6):** `template/.github/workflows/validate.yml` runs
  `.github/check/validate.mjs` (read-only; job `format`) on every pull request and push to `main`/`approved`. The keys come
  from `layout_keys.py`: the pinned hebrew-clause-layout revision's `data/clauses-<BOOK>.parquet`, per verse the rows in `seg`
  order as `clause_key-max(last)`, a repeated clause key `/2`; exactly the seeded `.units` keys (772/772 verses in JOS and DAN).
  `format.js` and the tokeniser are copies of `src/lib/` kept identical by a test. Beyond FORMAT.md section 6 it also refuses
  verse text not as the converter writes it, note kinds other than T E H N, unreadable `.align` items, front matter whose
  `book`/`chapter` do not match the file. All 299 seeded chapters pass with the real keys. `tools/init_language.sh` now makes
  `format` a required check on both branches. Found on the way: `alignPositions` skipped `+pos>ord` items (fixed). The Greek
  layout has no `clause_key`: NT keys are not checked yet.
- **Poetry lines (2026-11-02, handover step 5; FORMAT.md section 5):** `src/lib/poetry.js` places `.tanakh/poetry/<BOOK>.json`
  in a chapter: `clause` lines at the unit's first token; other lines through the `.align` ordinals, which count
  compact-alignments' `_index/<BOOK>_keys.json` / `_fn_keys.json` (`tools/fetch_index.mjs` -> `$MTR_DATA/index`, sha-checked).
  A word-keyed line is taken as its Hebrew words, from the start of its word's clause (unless another line begins in between) to
  the next line's word, and begins at the first target token any of them is linked to, moved back over tokens no link names
  (not over an added word owned by an earlier Hebrew word): the literal rule broke Danish lines mid-phrase where the word order
  differs from the BSB's (DEU 28:3 "Velsignet / er du i byen"). 235/235 lines of the seeded chapters are placed. The editor
  shows the lines under a verse while its text is the one loaded. Open for the grammar side: many `word` keys sit on a suffix
  part one word early (DEU 28:4 `050280040032`, 28:6 `050280060033`); 4,556 of 12,446 `word` keys are on a part other than 1.

- **GitHubStore (2026-11-02, PLAN.md 15.6 step 2, against a mock):** `src/lib/store/github.js`, the methods of LocalGitStore over
  the REST API. The store interface became async (the flows await it; LocalGitStore is unchanged and simply answers at once).
  Reads through the Git Data API (ref, recursive tree, blobs; immutable objects cached across requests) rather than the Contents
  API: one tree serves every file of a commit, and `changedFiles` compares two trees (exact for any two commits; compare's file
  list is three-dot and capped at 300). Writes: tree + commit + ref moved without force, so GitHub's fast-forward rule is the
  compare-and-swap. The user's token writes their branch (in their fork when they cannot push, made on the first save) and opens
  their PR; the App's token writes main / approved / roles.json and labels, closes, comments. Tested with `test/github-mock.js`:
  the service tests now run on both stores (8 each), plus 7 GitHub tests (tokens and authorship, forks, the fork head as merge
  parent, a race, the cache, labels, the App's JWT). **To check on real GitHub** (the mock assumes them): creating a ref or a commit in
  a fork naming a commit that only the parent has (shared fork-network objects; else sync the fork first); that GitHub marks a PR
  merged at once when its head reaches main by our merge commit; fork creation timing (the store waits up to ten tries).
  Not done: OAuth sign-in, `storeFor` choosing GitHubStore, the language list from the organisation, rate-limit answers.

- **GitHub sign-in (2026-11-03, 15.6 step 2):** the App's user authorisation (`src/lib/oauth.js`, `/api/signin` -> github.com ->
  `/auth/callback`), with a sealed ten-minute cookie carrying the state, the CC0 tick and the page to return to. The session
  cookie is now sealed (AES-256-GCM), not just signed, in both modes: it holds the user's token and refresh token, so the server
  keeps nothing (Netlify has no disk); an expired token is refreshed on the next request, a spent one signs the user out. The
  CC0 agreement with GitHub: ticked at sign-in, remembered in a year-long sealed cookie for that login, and stated in each pull
  request body (15.2 point 4). `config.js` picks GitHub when the five `MTR_GITHUB_*` settings are set (a partial set is an error);
  `languages()` and `storeFor(lang, user)` became async (the organisation's repos with the topic, cached five minutes; a
  GitHubStore per request with the user's token). 6 tests against the mock. The footer now credits the clause units as CC BY 4.0
  (MACULA via hebrew-clause-layout), as decided 2026-11-02, instead of CC BY-SA.
  **Found while writing it, open for the user:** a GitHub App's user token reaches only repositories the App is installed on.
  The App is installed on the organisation, so a collaborator's branch in the language repo works; an outside contributor's fork
  is in their own account, where the App is not, so their token cannot write it (and the fork call itself may need more than
  the App's permissions). Choices: (a) the contributor also installs the App on their account (GitHub can combine install and
  sign-in in one step; "all repositories" covers a fork made later), (b) the App writes outside contributors' `edit/<login>`
  branches in the language repo with its own token, the person as co-author (as the local test does; costs the App's shared rate
  limit), (c) an OAuth App with the `public_repo` scope instead (broad: it could write any public repo of the user). GitHubStore
  as written does (a) and, for collaborators, the language repo; (b) is a small change in `writer()` / `home()`.
  **Decided (user, 2026-11-04): (b).** GitHubStore no longer makes forks: every `edit/<login>` branch is in the language repo,
  written with the user's token when they can push there and by the App otherwise (co-authored by them); the user's token
  still opens their pull request. The mock now refuses an App user token outside the repos the App is installed on.

## 13. Moving to its own repo (planned 2026-10-31, not done)

1. Decisions (user): name and place (proposed bcv-commons/make-tanakh-review; local checkout next to the other bcv-commons repos,
   $BCV_COMMONS/make-tanakh-review), public or not, the code licence, where the seeding step lives.
2. Seeding out of the editor: `prepare_chapter.py` is the only code tied to other repos (the work repo's toolkit, $ALIGNER_DATA). It
   belongs to the drafting side (make-tanakh, as an export step that writes clause-unit chapters); the editor keeps `init_local.sh`
   / `add_chapters.sh`, which read a seed folder and need nothing else. Until it moves, it stays here (lab) with its settings.
3. Licence check before anything is public: the clause keys in the CC0 language repos encode the clause boundaries of
   hebrew-clause-layout (CC BY-SA 4.0). Either credit it and accept share-alike for that column, ask bcv-query (its builder) whether
   the clause boundaries can be offered under CC BY like MACULA, or cut clauses from MACULA Hebrew (CC BY 4.0) directly.
4. Repo files: README, CLAUDE.md (user commits; outward actions on the user's go; CC0 for language repos; never protected text),
   LICENSE for the code, `.gitignore` (node_modules, dist, .netlify, .astro, .local), `engines.node` in package.json, `netlify.toml`
   (build command, Node version), `.env.example` (MTR_DATA, MTR_SESSION_SECRET), a pre-commit screen like this repo's (refuse
   protected text and data files).
5. Move: copy without node_modules / dist / .netlify / .astro; `.local/` moved too (local test data, never tracked); `git init`;
   `pnpm install`, `pnpm test`, `pnpm build`, `pnpm dev` checked there; the user makes the first commit and push.
6. Here afterwards: the folder and its `.gitignore` line removed; RELATIONS.md gets the editor's place among the repos (the user's
   decision); CLAUDE.local.md and memory updated; seeding scripts that stay in the lab point at the new repo through a setting.
- **Moved and renamed (user, 2026-10-31):** make-tanakh-edit -> make-tanakh-review, its own repo at `~/dev/make-tanakh-review`
  (beside make-tanakh-grammar; git initialised, no commit, no remote). Settings renamed MTE_* -> MTR_*, cookies mte_* -> mtr_* (signing
  in again is needed once), the bot make-tanakh-review[bot]. Added: LICENSE (MIT, as make-tanakh-grammar), CLAUDE.md, netlify.toml,
  .env.example, `engines.node`, a pre-commit screen (tools/screen.sh: no .local, .env, data files or files over 1 MB). The seeding
  tool stays here for now and reads make-tanakh-grammar's env.sh. The local test repo's earlier commits keep the old bot name.

## 14. Link sidecars for review (planned 2026-10-31, user's go)

Measured in make-tanakh-grammar (Zinza NLLB drafts, RUN.md 2026-10-31): where two independent alignment runs link a Hebrew/Greek word
to the same draft words, the link is right ~0.90 of the time (eflomal chain 0.885; with Jev 0.90); where they differ, ~0.70-0.75.
Unlinked words are a weak signal (the aligners link 92-96% of the words; such flags catch 6-13% of the real gaps). So the reviewer
gets the two-run agreement, per Hebrew word, beside each clause.

**File** (superseded 2026-11-02 by 16.5: the statuses live in the `.align` sidecar's profile letters): next to each chapter in the language repo, `<BOOK>/<BOOK>_<CCC>.links.json`, written by the bot only (never by people),
CC0 like the rest (only draft text positions and MACULA word identifiers):

```
{"spec": "make-tanakh-review links/1", "chapter": "GEN 20", "made": "<date>", "method": "align-text eflomal chain, 2 runs",
 "verses": {"<v>": {"fp": "<fingerprint of the verse text>",
                     "words": {"<MACULA word id>": {"status": "firm" | "check" | "unlinked", "spans": [[s, e], ...]}}}}}
```

`status`: firm = both runs link the word to the same draft tokens; check = they differ (or only one links it); unlinked = neither.
`spans` = character ranges in the verse text (the units joined with a space) of the tokens run 1 links (the union of both runs for
`check`). `fp` = FNV-1a 32-bit of the verse text (the same function in Python and the browser), so the editor knows when a verse
has changed since the sidecar was made.

**Made by** `tools/build_links.py` (this build: by hand; later the bot after each merge into main, re-aligning the chapters whose
verse fingerprints changed): the chapters' text (units joined) inside a CC0 corpus of the same language (Danish: Den Frie Bibel for
the books and chapters without a draft), align-text twice (`--runs 2`, eflomal chain, no Jev; `--jev` later costs cents per
chapter), compact layers -> sidecars; `tools/add_links.sh` commits them to main as the bot. The lab's held-out chapters (GEN 22, 37,
44) are left out of the corpus.

**In the editor**: each Hebrew content word shows its status (check: amber underline; unlinked: dotted grey); hovering a Hebrew word
highlights its draft words in the clause box (solid firm, dashed check) and hovering is the only way links are shown (no clutter);
each clause's label shows "n to check"; a verse whose text no longer matches its fingerprint shows "links out of date" and no marks.
The seed-time "unlinked" outline (from the draft's own one-run alignment) is dropped where a sidecar exists.
- **Link sidecars built (2026-10-31):** `tools/build_links.py` (text, sidecars) + `tools/add_links.sh`; the 29 seeded chapters inside
  Den Frie Bibel (11,207 corpus verses + 963 draft verses; GEN 22/37/44 absent from both), align-text `--runs 2`, eflomal chain, no
  Jev. Danish Hebrew content words: firm 91.0%, check 6.6%, unlinked 2.4% (Zinza NT drafts: two thirds agreed; Danish has a large
  corpus and a language the aligner's priors know). Editor: statuses on the Hebrew words, hover marks in a mirror layer behind each
  clause box, "n to check" on the clause label, "links out of date" on a changed verse; 3 jsdom tests (20 in all); checked on
  GEN 20 and JOS 1 (no stale verse on main; e.g. JOS 1 "the.sole" -> "har" marked to check). The seed-time outline is dropped
  where a sidecar exists. Not yet: re-aligning after a merge (by hand: rerun the steps), Jev on the sidecar runs.

## 15. global-tanakh: the language repos on GitHub, edited in place (user's decision 2026-11-02; planned, not built)

### 15.1 The decision

Every CC0 draft of ours is published into a GitHub organisation, **global-tanakh** (name confirmed by the user 2026-11-02;
make-tanakh, the tool, stays under bcv-commons), **one repository per language**
(`global-tanakh/<lang>`), so that all the books of every language are open and under version control on GitHub. Those
repositories are the editor's only store: the editor edits the text right inside them with ordinary git objects (branches,
commits, pull requests), and anyone can do the same with a clone or on github.com. A single repository for all languages was
considered and set aside: per-language ownership (branch rules, CODEOWNERS, forks, releases, a team taking its repo elsewhere
whole) is native per repository, and pull requests and history stay per language. The single-repo variant would work with
`<lang>/<BOOK>/` paths, path-based CODEOWNERS and `approved/<lang>` branches, with the App enforcing roles by path: more
rules for the same result.

What a language repo holds: its Tanakh drafts (ours, CC0) and, only if the team puts it there under CC0, its NT. Kuni is never
there (NC-ND inputs; its drafts stay in `local_output/`). The corpora of the make-tanakh-work repo's `export/CC-NC/` are not
published either.

### 15.2 What changes for this project

Little, because the local store is already one bare repo per language (section 4.1) with routes per language (section 7):

1. **`GitHubStore` maps one to one:** language = repository `global-tanakh/<lang>`; the same `main`, `approved` and
   `edit/<login>` branches; the store interface of section 8 unchanged. `readFile` = Contents API (the blob sha is the version);
   `writeFile` = Git Data API (blob, tree, commit, `update-ref` with the expected sha as the compare-and-swap, as LocalGitStore
   does); pull requests = Pulls API; `commitMerge` = a merge commit with two parents written through Git Data, then the PR marked
   merged (we never use GitHub's own merge button, because our merge is by verse, section 6).
2. **Two tokens, not one.** A proposal (save) is committed with the **editor's own token** (user-to-server, GitHub OAuth through
   the App's user authorisation): the commit is authored by the person who gives it under CC0, and the request counts against
   their own rate limit. The **App's installation token** is used only for the privileged steps: reviewer merges into `main`,
   the team's approvals into `approved`, the bot's sidecars (section 14) and seeding. Roles stay in the repo's `roles.json`
   (reviewers self-serve, team set by hand) and are mirrored to CODEOWNERS for github.com.
   **Where the user's branch lives (2026-11-02):** a user-to-server token acts with the user's own rights, and someone off the
   street has no write access to `global-tanakh/<lang>`, so their `edit/<login>` branch cannot be pushed there. The standard
   answer is the one github.com itself uses for outside contributors: the editor forks the repo on the user's behalf (one
   API call, under their token, once per language), writes the branch in the fork and opens the pull request from the fork.
   Team members and anyone given write access keep their branch in the main repo. The merge by verse still works: a PR's head
   commit is reachable in the base repo as `refs/pull/N/head`, so the App's merge commit can name it as a parent. (The
   alternative, adding every signed-in user as a write collaborator, is refused: write collaborators can change workflows and
   push to unprotected branches.) Nobody sets up a token by hand: the sign-in flow issues the user token, the server mints
   the App's installation token from the private key whenever it needs one.
3. **Any pull request into `main` is a proposal**, whoever made it and however (the editor, a clone, github.com). The review
   page lists every open PR of the repo whose changes are chapter files, shows its clause diff, and merges it by verse. A PR
   that touches other files (README, sidecars) is shown but merged only on github.com.
4. **Sign-in is GitHub OAuth** (the App's user authorisation flow); the CC0 agreement at first sign-in is recorded as a line in
   the user's first pull request body ("edits given under CC0", date), so it lives in the repo, not in a side file.
5. **The language list** comes from the organisation: repositories with the topic `global-tanakh` (one paginated list call,
   cached for a few minutes), or from a small index repository `global-tanakh/index` (README + `languages.json`: code, name,
   books present, chapters on main / approved). The index is written by the bot after merges.
6. **Creating a language** is one call from a **template repository** `global-tanakh/template` (README, LICENSE CC0,
   CONTRIBUTING "edits are given under CC0", CODEOWNERS, `roles.json`, the two branches, the topic) plus the branch rules
   (point 15.4). `init_local.sh` becomes `init_language.sh <lang>` against GitHub; `add_chapters.sh` stays as it is in spirit:
   a chapter already present is never overwritten.
7. **Seeding and re-drafting.** The drafting side (make-tanakh-grammar / the work repo, section 15.5) pushes new chapters as
   the bot: a chapter absent from the repo is added to `main` and `approved` in one commit each (as now); a **re-draft of a
   chapter that exists** arrives as a pull request from a bot branch (`draft/<date>`), so a human merge decides and edits made
   in review are never lost to a rerun.
8. **Chapter format (decided 2026-11-02, FORMAT.md in the template; replaces the clause-unit `.tsv`):** the text is a
   Markdown file with one verse per line (`c:v<TAB>text`), so `git diff` reads verse by verse; clause units, alignment, notes
   and poetry layout are line-per-verse sidecars anchored by token index (16.5). The editor's clause view is built from the
   `.md` + `.units` on load and written back the same way. **Derived formats** (plain verse text, USFM, the drafting
   pipeline's own chapter file) are built from these files, not kept beside them: one workflow in the `index` repository
   reads every language repo and publishes them as a release or on a `dist` branch there.

### 15.3 Scale: 1,000+ languages on GitHub Free (checked 2026-11-02)

- GitHub Free for organisations: unlimited public repositories, unlimited collaborators, the full feature set; Actions on
  standard runners free in public repositories. GitHub states no cap on repositories per organisation (a third-party figure of
  100,000 circulates, unconfirmed in GitHub's documentation). Nothing in the terms restricts an organisation of CC0 / CC BY-SA
  text repositories.
- **The API is the ceiling, not the repository count.** One App installation on the organisation gets 5,000 requests per hour,
  plus 50 per repository over 20, capped at 12,500 per hour; GitHub Actions' `GITHUB_TOKEN` 1,000 per hour per repository;
  unauthenticated 60 per hour per IP; and a secondary limit on content-creating requests (commits, PRs) that is tighter still.
  A save is about five requests, a merge two or three. With the App alone, the whole organisation would share on the order of
  2,000 writes per hour. Hence point 15.2.2: proposals under the editor's own token (5,000 per hour each), the App for merges,
  approvals and the bot. If the App's share ever binds, a second App (or an organisation per region) doubles it.
- Size: a whole Tanakh in clause-unit files is a few megabytes per language; clones and the API are untroubled.
- Notifications and discovery: a GitHub team per language (`@global-tanakh/<lang>`) in CODEOWNERS; topics for discovery; the
  index repository for the list.

### 15.4 Rules and security on GitHub

- Branch rules on `main` (pull request required, no force-push, no deletion) and `approved` (no direct pushes except the App,
  which writes only on a team member's approve action). Organisation-level rulesets by pattern if the plan allows them for
  public repositories; otherwise `init_language.sh` sets per-repository protection through the API (free on public repos).
- No secrets in language repos (write collaborators can change Actions workflows); the App's key and client secret only in the
  editor's server environment (Netlify); the index repo's workflow reads with a fine-grained read-only token.
- The licence check of section 13.3 is settled **before the first public push**: the clause keys encode hebrew-clause-layout's
  clause boundaries (CC BY-SA 4.0). Either a credited CC BY-SA sidecar column, or bcv-query's agreement to CC BY for the
  boundaries, or clauses cut from MACULA Hebrew (CC BY 4.0) directly. Until then, no language repo is public.
  **Checked 2026-11-02 (make-tanakh-grammar session):** the layout's own card lists its sources part by part: the clauses,
  words, clause kinds and rules are MACULA Hebrew (CC BY 4.0); CC BY-SA comes from the UHB text and from the text-level
  hierarchy (discourse columns), which bcv-commons compiled. The repo's key column holds `clause_key` only, which is the MACULA
  word identifier of the clause's first word: all 89,940 layout rows checked, every key is a MACULA word id, and the keys
  name MACULA's own clause nodes (87,582 of them; 2,266 are split into segments by the layout, but a split clause still has
  one key and the repo records no segment). No UHB text and no discourse column reaches the repo. So the key column is
  MACULA-derived (CC BY 4.0, credited in the template's LICENSE and README) and nothing share-alike is in a language repo.
  The user confirms this reading before the first public push; a note to bcv-query is then a courtesy, not a condition.

### 15.5 Division of work between the repos

- **make-tanakh-review (this repo):** `GitHubStore`, OAuth sign-in, the two-token model, the review page over all PRs, the
  index reader, `init_language.sh`, the template repository's contents, the derived-formats workflow.
- **The drafting side** (make-tanakh-grammar's `internal-docs/global-tanakh-publishing.md` holds its side): the export step
  that turns a CC0 project's chapters into clause-unit files (`prepare_chapter.py`, which belongs there, section 13.2), the
  publish step that seeds or proposes them as the bot, and the licence gate (only projects whose `project.yaml` says CC0, never
  `export/CC-NC/`, never `local_output/`).
- **The user:** creates the organisation, the App and the Netlify site (section 12); every push is the user's go until the
  bot's publishing is delegated once, explicitly, for CC0 projects only.

### 15.6 Order of work

1. Licence check of the clause keys (15.4); until settled, everything below runs against a private test organisation or the
   local bare repos.
2. `GitHubStore` with the store tests of section 10 run against a throw-away repository; OAuth sign-in; the two tokens.
3. The template repository and `init_language.sh`; branch rules; the index repository and its reader.
4. Move the Danish test chapters (JOS 1-2, GEN 20-50 without 22/37/44/28) from `.local/repos/dan.git` to `global-tanakh/dan`
   with their history (a plain push of the bare repo), sidecars included.
5. The derived-formats workflow; the bot's re-draft proposals; the publish step on the drafting side.
6. Netlify site with the App's environment; the reviewer-request issue form for github.com users.

## 16. The aligner inside the editor (user's decision 2026-11-02; planned, not built)

### 16.1 The decision

Alignment is handled in the editor, where the text and its alignment change together and where a person can confirm a link.
Nothing aligns in CI: continuous integration validates (16.6) and never writes links. The batch aligner (lexeme-aligner's
align-text, eflomal, two runs) is used only at seed time, through the drafting agents' delivered `.align` file, which becomes
the sidecar's first version. A user may add a Jev pass with their own API key (16.4).

Why not CI: align-text learns from a whole corpus and runs for minutes; it cannot run per edit, and it cannot run inside a
Netlify function at all (time limit, binary, corpus on disk). Why the editor: the person editing sees the links, corrects them,
and that correction is worth more than any re-run.

### 16.2 The per-verse aligner (`src/lib/align.js`, shared by browser and server like `units.js`)

Deterministic, milliseconds, no corpus. For one verse it takes the Hebrew words (MACULA ids, lexeme, gloss, content flag, from
the spine), the verse's current text and units, and the verse's previous links, and returns new links with a status per word:

1. **Projection.** Tokenise old and new text (the toolkit's tokenisation, ported: `units.js` already shares the split/join
   rules); diff the token sequences; a token that survived keeps its links (`spans` moved to its new offsets); a token that
   changed or is new has no link yet; a Hebrew word whose tokens all vanished becomes `unlinked`. Status of surviving links is
   kept (`firm`, `human`, ...); a link whose target token changed becomes `check`.
2. **Proposal** for the Hebrew content words left unlinked, from the language's evidence: the lexeme store of
   bcv-commons/language-analysis (Hebrew lexeme -> the language's forms with counts; CC0; one JSON per language, loaded once
   on the server and cached) and the MACULA gloss. A candidate = a free token of the verse whose form is in the lexeme's
   entry (exact form, then stem by the language's segmenter bundle if published, then the store's variants). One candidate
   -> status `proposed`; several -> the commonest by count, status `check`; none -> `unlinked`. Positions prefer the unit
   whose clause key is the word's clause (the layout gives each Hebrew word its clause), so proposals respect the cuts.
3. **Order**: Hebrew words of one clause tend to map inside one unit in order; a proposal that would cross into another
   unit is marked `check`, never dropped.

Not a new corpus aligner: it maintains lexeme-aligner's layers between batch runs, with their own stores as the evidence.
The standing decision "alignment delegated, no own aligner development" (make-tanakh-grammar, 2026-10-30) is amended to that
extent, and the module is offered to lexeme-aligner as a contribution once it works (user's go).

### 16.3 Human links

In the editor, hovering a Hebrew word shows its draft words (section 14). Clicking a Hebrew word and then a draft word (or
dragging across several) sets the link by hand; clicking the link mark removes it. A hand-set link has status `human` and
is never overwritten by projection or proposal (only by another person). `human` links are the most valuable data in the
repo: they are the review's own alignment, they go into the sidecar with the author's login, and they are what lexeme-aligner
can learn from (16.7). A save writes text, units and links in one commit.

### 16.4 Jev on top, with the user's own key

A user who has a TypeSafe API key enters it in the editor (settings); it is held in the server session only (encrypted
cookie value, never written to a repo, a log or the database of roles) and used server-side. On request ("judge this verse"
/ "judge this chapter") the server asks Jev the way lexeme-aligner's `--jev` layer does: per Hebrew content word with status
`check` or `unlinked`, a Noul "does the draft word(s) X render the Hebrew word Y (gloss, lexeme) in this verse?" for each
candidate, with the verse's Hebrew (glosses, MACULA), the draft text and the units as state, several questions over the same
state in one request. A candidate at p >= 0.8 becomes `jev` (with p); below, the status stays. A few questions per verse, cents
per chapter, shown as an estimate before the run. Only CC0 drafts reach the editor, so nothing protected is sent; the user's key
means the user is TypeSafe's customer and owns the answers (their terms: no training on inputs without consent; outputs
assigned to the customer).

### 16.5 The sidecars (decided 2026-11-02; replaces the `.links.json` of the first draft of this section)

The published chapter format is the template's **FORMAT.md**: `<BOOK>_<CCC>.md` (YAML front matter with the status fields,
`# title`, `## headings`, then one verse per line `c:v<TAB>text`, translatable text only) plus four line-per-verse sidecars
anchored by token index of the standard tokeniser (compact-alignments v2 = the bibles repository's `bcv_tokenize`):
`.align` (the drafting agents' compact-alignments working file, unchanged), `.units` (clause keys with token ranges),
`.notes` (inline notes with their anchor token), `.layout` (poetry line breaks). Verified 2026-11-02 on the 431 Danish
chapters: the verse-per-line text round-trips through the toolkit's reader with identical tokens, and the `.align` file's
`# text` hash is the SHA-256 of exactly those verse lines, so text and alignment verify each other with no other file
(302 matched; 129 were stale in the work repo and are refused by the publish gate until re-aligned).

The editor's link statuses go into the `.align` file's per-verse **profile letter** (`a` script, `b` agent, `h` checked by a
person, `j` judged by Jev, `s` re-projected after an edit, not checked) instead of a JSON sidecar; a verse whose text no
longer hashes is *stale* and re-projected on load (16.2). The editor writes the `.md` and, in the same commit, every sidecar
whose token indexes the edit moved. People never edit the sidecars by hand; CI checks them (16.6). The units file's header
says `authored` / `aligned` / `edited`; the first cut is made once at seed and then belongs to people.

### 16.6 What continuous integration does (validation only, on every pull request; seconds; GitHub-hosted)

FORMAT.md section 6: the `.md` parses (front matter, ascending verse lines, nothing else); `.align` hashes the text, profile
letters from the list, positions inside the verse; `.units` keys exist in the repo's pinned layout (`.tanakh/layout.json`:
dataset, revision, MACULA commit), in Hebrew order, no key twice, ranges inside the verse, each token in at most one unit,
discontinuous Hebrew clauses in the layout's own notation (`A/2`) distinct from a translator's split (`A.2`); `.notes` and
`.layout` anchors inside the verse; no secrets; a PR that touches other files is merged on github.com only. CI never rewrites
a file.

### 16.7 What flows back

- To lexeme-aligner: `human` and `jev` links as evidence for its priors (an export per language from the sidecars, CC0;
  offered on the user's go).
- To the drafting side: the re-draft proposal (`publish_global.py --propose`) re-cuts only verses whose text changed, from the
  new draft's `.align`, and leaves every other verse's units and links as the people left them.

### 16.8 Order of work (after section 15's steps 1-4)

1. `align.js`: projection + proposal, with tests on the local Danish repo (edit a verse, check the links move; remove a word,
   check `unlinked`; the lexicon proposal on a known Hebrew lexeme).
2. The published chapter format in the editor: `units.js` and the store read and write `<BOOK>_<CCC>.md` + `.units`
   (and carry `.notes`/`.layout` through) instead of the `.tsv` (14 references in `src/` and `tools/` on 2026-11-02; the
   local test repo `.local/repos/dan.git` is re-seeded by the drafting side's `publish_global.py`); `.align` profile
   letters as the statuses; CI validation of FORMAT.md section 6; `.tanakh/layout.json` in the template.
3. The hand-set link in the editor (click, drag, remove) and the save that carries links.
4. Jev: the settings page for the key, the per-verse questions, the estimate, the `jev` status.
5. The export of `human`/`jev` links for lexeme-aligner (user's go to send).
