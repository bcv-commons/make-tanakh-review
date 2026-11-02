"""The clause keys of the pinned Hebrew layout, per verse, for validate.mjs (FORMAT.md sections 3 and 6). Reads only.

    python3 .github/check/layout_keys.py <repo root> <out.json> [--cache DIR]

Reads .tanakh/layout.json (dataset and revision of bcv-commons/hebrew-clause-layout), fetches data/clauses-<BOOK>.parquet at
that revision from Hugging Face for every Hebrew book folder in the repository (kept in --cache), and writes
{BOOK: {"c:v": [key, ...]}}: a verse's clauses in the layout's order (seg), each as its span `first-last` (the clause key and
the last word over all its segments), a clause met again in the verse as `/2`, `/3` (its next segment). Needs pyarrow.
The layout's clauses and word ids are MACULA Hebrew's (CC BY 4.0)."""
import collections
import json
import os
import sys
import time
import urllib.request

import pyarrow.parquet as pq

HEBREW = set("GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN "
              "HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL".split())


def fetch(url, dest):
    for attempt in range(4):
        try:
            tmp = dest + ".part"
            with urllib.request.urlopen(url, timeout=60) as r, open(tmp, "wb") as out:
                out.write(r.read())
            os.replace(tmp, dest)
            return
        except Exception as e:  # network trouble: retry, then give up loudly
            if attempt == 3:
                raise SystemExit(f"cannot fetch {url}: {e}")
            time.sleep(5 * (attempt + 1))


def keys(path):
    rows = pq.read_table(path, columns=["chapter", "verse", "seg", "clause_key", "last"]).to_pylist()
    last = collections.defaultdict(str)
    for r in rows:
        last[r["clause_key"]] = max(last[r["clause_key"]], r["last"])
    out, seen = collections.defaultdict(list), collections.Counter()
    for r in sorted(rows, key=lambda r: (r["chapter"], r["verse"], r["seg"])):
        k = r["clause_key"]
        seen[k] += 1
        out[f"{r['chapter']}:{r['verse']}"].append(f"{k}-{last[k]}" + (f"/{seen[k]}" if seen[k] > 1 else ""))
    return out


def main(argv):
    root, dest = argv[0], argv[1]
    cache = argv[argv.index("--cache") + 1] if "--cache" in argv else os.path.join(root, ".layout-cache")
    pin = json.load(open(os.path.join(root, ".tanakh", "layout.json"), encoding="utf-8"))["hebrew-clause-layout"]
    books = sorted(d for d in os.listdir(root) if d in HEBREW and os.path.isdir(os.path.join(root, d)))
    folder = os.path.join(os.path.expanduser(cache), pin["revision"])
    os.makedirs(folder, exist_ok=True)
    out = {}
    for b in books:
        p = os.path.join(folder, f"clauses-{b}.parquet")
        if not os.path.exists(p):
            fetch(f"https://huggingface.co/datasets/{pin['dataset']}/resolve/{pin['revision']}/data/clauses-{b}.parquet", p)
        out[b] = keys(p)
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{pin['dataset']}@{pin['revision'][:12]}: keys of {len(books)} books ({' '.join(books)})")


if __name__ == "__main__":
    main(sys.argv[1:])
