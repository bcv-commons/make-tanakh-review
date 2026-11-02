#!/bin/sh
# Commit link sidecars (tools/build_links.py sidecars -> .local/links/sidecars/<BOOK>/<BOOK>_<CCC>.links.json) to main of the local
# language repo, as the bot: sidecars are the bot's files and are replaced as a whole.   sh tools/add_links.sh [lang]
set -e
LANG_CODE=${1:-dan}; D=$(cd "$(dirname "$0")/.." && pwd)/.local; R=$D/repos/$LANG_CODE.git; SC=$D/links/sidecars
[ -d "$SC" ] || { echo "no $SC: run tools/build_links.py sidecars first"; exit 1; }
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
git clone -q -b main "$R" "$W/w"
n=0
for f in $(cd "$SC" && find . -name "*.links.json" | sed 's#^\./##' | sort); do
  [ -e "$W/w/${f%.links.json}.tsv" ] || continue
  mkdir -p "$W/w/$(dirname "$f")"; cp "$SC/$f" "$W/w/$f"; n=$((n + 1))
done
git -C "$W/w" add -A
if git -C "$W/w" diff --cached --quiet; then echo "main: sidecars unchanged"; exit 0; fi
git -C "$W/w" -c user.name="make-tanakh-review[bot]" -c user.email=make-tanakh-review@users.noreply.local commit -q -m "Links: $n chapter sidecars (two alignment runs)"
git -C "$W/w" push -q origin main
echo "main: $n sidecars committed"
