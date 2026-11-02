#!/bin/sh
# Create the template repository global-tanakh/template from template/ (once per organisation; user's go).
#   sh tools/init_template.sh [org]
set -e
ORG=${1:-global-tanakh}; D=$(cd "$(dirname "$0")/.." && pwd)/template
gh repo create "$ORG/template" --public --description "Template for a global-tanakh language repository (CC0)"
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
cp -r "$D/." "$W/"; git -C "$W" init -q -b main; git -C "$W" add -A
git -C "$W" -c user.name="make-tanakh-review[bot]" -c user.email=make-tanakh-review@users.noreply.github.com commit -q -m "Template for a language repository"
git -C "$W" remote add origin "git@github.com:$ORG/template.git"; git -C "$W" push -q origin main main:approved
gh repo edit "$ORG/template" --template
echo "created $ORG/template (a template repository, branches main and approved)"
