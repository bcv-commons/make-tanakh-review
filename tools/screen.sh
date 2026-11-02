#!/bin/sh
# Pre-commit screen (.githooks/pre-commit): this repo holds code and docs only. Refused: anything under .local/, .env, data and
# binary files (.db .sqlite .parquet .jsonl .tsv .zip .pt .bin), and any file over 1 MB.
status=0
for f in $(git diff --cached --name-only --diff-filter=ACM); do
  case "$f" in
    .local/*|.env|*.db|*.sqlite|*.parquet|*.jsonl|*.tsv|*.zip|*.pt|*.bin) echo "refused (data or local file): $f"; status=1; continue ;;
  esac
  size=$(git cat-file -s ":$f" 2>/dev/null || echo 0)
  [ "$size" -gt 1048576 ] && { echo "refused (over 1 MB): $f"; status=1; }
done
exit $status
