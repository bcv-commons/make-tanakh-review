#!/bin/sh
# Create the local test language repo (PLAN.md section 2): a bare git repo .local/repos/<lang>.git with README, LICENSE (CC0),
# CONTRIBUTING and the seeded chapters (tools/prepare_chapter.py -> .local/seed/) on main, the same on approved, and the roles.
#   sh tools/init_local.sh [lang] [team login]      (defaults: dan teamlead); refuses to overwrite an existing repo
set -e
LANG_CODE=${1:-dan}; TEAM=${2:-teamlead}; D=$(cd "$(dirname "$0")/.." && pwd)/.local
R=$D/repos/$LANG_CODE.git
[ -e "$R" ] && { echo "$R exists: remove it first to re-seed"; exit 1; }
[ -d "$D/seed" ] || { echo "no $D/seed: run tools/prepare_chapter.py first"; exit 1; }
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
cp -r "$D/seed/." "$W/"
cat > "$W/README.md" <<TXT
# Tanakh drafts ($LANG_CODE): clause by clause

Drafted Tanakh chapters, one clause unit per line (\`<BOOK>/<BOOK>_<CCC>.tsv\`: verse, Hebrew clauses, text), edited with
make-tanakh-review. The Hebrew clauses are named by the keys of MACULA Hebrew (the clause layout of bcv-commons).

Branches: \`main\` is the working text that reviewers merge proposals into; \`approved\` is the text the language team has approved.
Licence: CC0 1.0 (see LICENSE); every edit is given under CC0 (CONTRIBUTING.md).
TXT
cat > "$W/LICENSE" <<'TXT'
CC0 1.0 Universal: to the extent possible under law, the contributors have waived all copyright and related or neighboring rights
to this work. Full text: https://creativecommons.org/publicdomain/zero/1.0/legalcode
TXT
cat > "$W/CONTRIBUTING.md" <<'TXT'
# Contributing

Edit in make-tanakh-review (no git needed): sign in, edit clause by clause, save. Each save is a commit on your own branch and opens
one pull request; a reviewer merges it into `main`; the language team approves chapters into `approved`.

By saving an edit you give it under CC0 1.0 (public domain dedication), as all text here.
TXT
git init -q --bare -b main "$R"
git -C "$W" init -q -b main
git -C "$W" add -A
git -C "$W" -c user.name="make-tanakh-review[bot]" -c user.email=make-tanakh-review@users.noreply.local commit -q -m "Seed: drafted chapters as clause units"
git -C "$W" push -q "$R" main main:approved
mkdir -p "$D/state"
printf '{"prs": [], "roles": {"reviewers": [], "team": ["%s"]}}\n' "$TEAM" > "$D/state/$LANG_CODE.json"
echo "seeded $R: $(git --git-dir "$R" ls-tree -r --name-only main | grep -c tsv) chapters; team: $TEAM"
