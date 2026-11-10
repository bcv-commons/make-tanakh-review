#!/bin/sh
# Create a language repository in the global-tanakh organisation from the template (PLAN.md section 15.2.6), set its topic,
# branch rules and team, with gh (signed in as an organisation owner). Nothing here runs without the user's go.
#   sh tools/init_language.sh <lang> "<Language name>" [org] [bcp47] ["<name in the language>"]
#   e.g. sh tools/init_language.sh dan "Danish" global-tanakh da dansk
# <lang> is the ISO 639-3 code; bcp47 the tag for spell checking (the 2-letter code where there is one; default <lang>).
# Before the first run, once per organisation: the template repository itself (tools/init_template.sh) and the GitHub App
# installed on all repositories (internal-docs/tokens-who-sets-up-what.md).
set -e
LANG_CODE=${1:?lang code}; NAME=${2:?language name}; ORG=${3:-global-tanakh}; TAG=${4:-$LANG_CODE}; NATIVE=${5:-}; REPO=$ORG/$LANG_CODE
gh repo create "$REPO" --template "$ORG/template" --public --description "Tanakh drafts in $NAME, clause by clause (CC0)" --include-all-branches
sleep 3
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
gh repo clone "$REPO" "$W/r" -- -q
sed -i "s/LANG_NAME/$NAME/g; s/LANG_CODE/$LANG_CODE/g" "$W/r/README.md" "$W/r/CODEOWNERS"
# the language's name and tag for the editor (FORMAT.md section 11)
node -e 'const [code, name, native, bcp47] = process.argv.slice(1); process.stdout.write(JSON.stringify({ code, name, ...(native ? { native } : {}), bcp47 }, null, 2) + "\n")' \
  "$LANG_CODE" "$NAME" "$NATIVE" "$TAG" > "$W/r/.tanakh/language.json"
git -C "$W/r" add .tanakh/language.json
git -C "$W/r" -c user.name="make-tanakh-review[bot]" -c user.email=make-tanakh-review@users.noreply.github.com commit -qam "Language: $NAME"
git -C "$W/r" push -q origin main
git -C "$W/r" push -q origin main:approved
gh api -X PUT "repos/$REPO/topics" -f 'names[]=global-tanakh' -f 'names[]=tanakh' -f "names[]=$LANG_CODE" >/dev/null
# a team per language (members added as the team forms); the App enforces roles.json, CODEOWNERS is for github.com
gh api "orgs/$ORG/teams" -f name="$LANG_CODE" -f description="$NAME language team" -f privacy=closed >/dev/null 2>&1 || true
gh api -X PUT "orgs/$ORG/teams/$LANG_CODE/repos/$REPO" -f permission=push >/dev/null 2>&1 || true
# branch rules: main needs a pull request, no force-push, no deletion; approved: no direct pushes except the App (bypass set in the UI);
# both need the format check (.github/workflows/validate.yml, job "format"; FORMAT.md section 6)
for BR in main approved; do
  gh api -X PUT "repos/$REPO/branches/$BR/protection" --input - >/dev/null <<JSON
{"required_status_checks": {"strict": false, "checks": [{"context": "format"}]}, "enforce_admins": false,
 "required_pull_request_reviews": $( [ "$BR" = main ] && echo '{"required_approving_review_count": 0}' || echo null ),
 "restrictions": null, "allow_force_pushes": false, "allow_deletions": false}
JSON
done
echo "created $REPO (main, approved; topic global-tanakh; team @$ORG/$LANG_CODE)"
