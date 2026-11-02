#!/bin/sh
# Add newly seeded chapters (.local/seed/, tools/prepare_chapter.py) to an existing local language repo, on main and approved: one
# commit each; a chapter already in the repo is left as it is (edits are never overwritten).   sh tools/add_chapters.sh [lang]
set -e
LANG_CODE=${1:-dan}; D=$(cd "$(dirname "$0")/.." && pwd)/.local; R=$D/repos/$LANG_CODE.git
[ -d "$R" ] || { echo "no $R: run tools/init_local.sh first"; exit 1; }
for BR in main approved; do
  W=$(mktemp -d)
  git clone -q -b $BR "$R" "$W/w"
  n=0
  for f in $(cd "$D/seed" && find . -name "*.tsv" | sed 's#^\./##' | sort); do
    [ -e "$W/w/$f" ] && continue
    mkdir -p "$W/w/$(dirname "$f")"; cp "$D/seed/$f" "$W/w/$f"; n=$((n + 1))
  done
  if [ $n -gt 0 ]; then
    git -C "$W/w" add -A
    git -C "$W/w" -c user.name="make-tanakh-review[bot]" -c user.email=make-tanakh-review@users.noreply.local commit -q -m "Seed: $n drafted chapters as clause units"
    git -C "$W/w" push -q origin $BR
  fi
  echo "$BR: $n chapters added"; rm -rf "$W"
done
