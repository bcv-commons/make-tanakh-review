#!/usr/bin/env python3
"""The Hebrew side of the editor for every chapter of the Tanakh (PLAN.md 4.2): per verse the Hebrew clauses in the layout's
order, each with its words (surface, English gloss, content word or not). The same for every language: nothing from a draft.

    python3 tools/build_hebrew.py --spine <lexeme-spine-macula.db> --out .local/hebrew [--cache .local/layout-cache] [BOOK ...]

  <out>/<BOOK>/<CCC>.json   {"book", "chapter", "verses": {"<v>": [{"key", "kind", "rule", "words": [{"id", "surface", "gloss",
                            "content"}]}]}}: one entry per layout segment (a clause interrupted by another has a later
                            piece); "key" is the clause key (the clause's first MACULA word id)
  <out>/build.json          the inputs (layout revision, spine release and its sha256), the credits, chapter counts

Inputs, both pinned in template/.tanakh/layout.json:
- bcv-commons/hebrew-clause-layout at the pinned revision (fetched from Hugging Face into --cache): only the segmentation
  (chapter, verse, seg, clause_key, words) and MACULA's clause fields (kind, rule), CC BY 4.0. Its UHB text and the discourse
  hierarchy (CC BY-SA 4.0) are not read.
- the lexeme spine (bcv-query's lexeme-spine-macula, checked against the pinned sha256): MACULA Hebrew's WLC surfaces, English
  glosses and content flags, CC BY 4.0.
Needs pyarrow."""
import argparse, collections, hashlib, json, os, sqlite3, time, urllib.request

import pyarrow.parquet as pq

BOOKS = ("GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN "
         "HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL").split()
HERE = os.path.dirname(os.path.abspath(__file__))
FORMAT = "make-tanakh-hebrew/1"


def fetch(url, dest):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r, open(dest + ".part", "wb") as out:
                out.write(r.read())
            os.replace(dest + ".part", dest)
            return
        except Exception as e:
            if attempt == 3:
                raise SystemExit(f"cannot fetch {url}: {e}")
            time.sleep(5 * (attempt + 1))


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def build_book(book, parquet, db):
    words = {}   # MACULA morpheme id -> (surface, gloss, content)
    for k, s, g, c in db.execute("select key, surface, gloss, is_content from spine_words where book = ? order by chapter, verse, idx", (book,)):
        words[k] = (s, g or "", bool(c))
    rows = pq.read_table(parquet, columns=["chapter", "verse", "seg", "clause_key", "kind", "rule", "words"]).to_pylist()
    chapters = collections.defaultdict(lambda: collections.defaultdict(list))
    missing = 0
    for r in sorted(rows, key=lambda r: (r["chapter"], r["verse"], r["seg"])):
        ws = collections.OrderedDict()   # a word is its morphemes (ids 12 digits; the word id is the first 11)
        for k in r["words"]:
            if k not in words:
                missing += 1
                continue
            s, g, c = words[k]
            w = ws.setdefault(k[:11], {"surface": "", "gloss": [], "content": False})
            w["surface"] += s
            if g:
                w["gloss"].append(g)
            w["content"] = w["content"] or c
        chapters[r["chapter"]][str(r["verse"])].append({"key": r["clause_key"], "kind": r["kind"] or "", "rule": r["rule"] or "",
            "words": [{"id": i, "surface": w["surface"], "gloss": " ".join(w["gloss"]), "content": w["content"]} for i, w in ws.items()]})
    return chapters, missing


def main(a):
    pins = json.load(open(os.path.join(HERE, "..", "template", ".tanakh", "layout.json"), encoding="utf-8"))
    lay, sp = pins["hebrew-clause-layout"], pins["spine"]
    got = sha256(a.spine)
    if got != sp["sha256"]:
        raise SystemExit(f"{a.spine}: sha256 {got}, not the pinned {sp['release']} ({sp['sha256']})")
    db = sqlite3.connect(f"file:{a.spine}?mode=ro", uri=True)
    folder = os.path.join(a.cache, lay["revision"])
    os.makedirs(folder, exist_ok=True)
    counts, missing = {}, 0
    for book in a.books or BOOKS:
        p = os.path.join(folder, f"clauses-{book}.parquet")
        if not os.path.exists(p):
            fetch(f"https://huggingface.co/datasets/{lay['dataset']}/resolve/{lay['revision']}/data/clauses-{book}.parquet", p)
        chapters, m = build_book(book, p, db)
        missing += m
        os.makedirs(os.path.join(a.out, book), exist_ok=True)
        for ch, verses in chapters.items():
            with open(os.path.join(a.out, book, f"{ch:03d}.json"), "w", encoding="utf-8") as f:
                json.dump({"format": FORMAT, "book": book, "chapter": ch, "verses": verses}, f, ensure_ascii=False, separators=(",", ":"))
        counts[book] = len(chapters)
        print(f"{book}: {len(chapters)} chapters" + (f" ({m} layout words not in the spine)" if m else ""), flush=True)
    build = {"format": FORMAT, "built": time.strftime("%Y-%m-%d"),
             "hebrew-clause-layout": {"dataset": lay["dataset"], "revision": lay["revision"], "columns": "chapter verse seg clause_key kind rule words"},
             "spine": {"release": sp["release"], "sha256": sp["sha256"], "columns": "key surface gloss is_content"},
             "licence": "CC BY 4.0",
             "attribution": lay["attribution"] + ". Words (WLC surfaces), English glosses and content flags: MACULA Hebrew, Clear Bible / Biblica (CC BY 4.0), through bcv-query's lexeme spine",
             "chapters": counts, "layout words not in the spine": missing}
    if not a.books:
        with open(os.path.join(a.out, "build.json"), "w", encoding="utf-8") as f:
            json.dump(build, f, ensure_ascii=False, indent=1)
    print(f"{sum(counts.values())} chapters; {missing} layout words not in the spine")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--spine", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--cache", default=".local/layout-cache")
    ap.add_argument("books", nargs="*")
    main(ap.parse_args())
