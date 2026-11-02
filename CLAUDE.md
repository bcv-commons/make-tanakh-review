# make-tanakh-review: notes for Claude

The review and editing web app for drafted Tanakh chapters, clause by clause (Astro on Netlify; pnpm through corepack). Read
`README.md`, then `docs/PLAN.md` (the design and its log). Sibling of make-tanakh-grammar (the lab, where it was first built) and
make-tanakh (the toolkit that drafts the chapters).

## Binding rules

- **The user commits and pushes.** Don't commit unless asked; give commit messages.
- **Outward-facing actions need the user's go:** creating or pushing the GitHub repo, a GitHub App, a Netlify site, notes or issues.
- **Language repos are CC0** (one per language): drafted chapters and every edit, also after the team's approval. Contributors agree
  at first sign-in.
- **No protected text ever**: no Bible text under a restrictive licence (the Kuni NT, HEBM95, ...), no BHSA or TBTA data, no draft
  made from protected inputs that has not passed the publishing screen. `.local/` (test data) is never tracked; the pre-commit
  hook (`core.hooksPath .githooks`, `tools/screen.sh`) refuses data files.
- **Credit the source side**: MACULA Hebrew (WLC) and MACULA Greek, CC BY 4.0, including the clause keys (spans of MACULA word
  ids); bcv-commons hebrew-clause-layout as the source of the clause boundaries. Its CC BY-SA parts (the UHB text, the discourse
  hierarchy) never reach a language repo (user's reading, 2026-11-02; `template/.tanakh/layout.json`).
- **Keep the store interface**: `src/lib/store/local-git.js` is the model for the GitHub version; flows in `src/lib/service.js` call
  only the store's methods.
- Tests: `corepack pnpm test` after every change; `corepack pnpm build` before calling something done.
