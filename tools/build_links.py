#!/usr/bin/env python3
"""Link sidecars for review (PLAN.md section 14).

  text      --seed DIR --corpus DIR --out DIR [--skip GEN:22,37,44]
            an align-text text folder (BOOK.txt, "c:v text" per line): the seeded chapters' verses (their units joined with a space,
            exactly as the editor shows them) inside a CC0 corpus of the same language (BOOK.txt files, same format) for every other
            chapter; the --skip chapters are left out entirely
  sidecars  --seed DIR --run1 DIR --run2 DIR --out DIR
            the two runs' compact layers (align-text --runs 2: OUT/compact/... and OUT/runs/run2/compact/...) -> one
            <BOOK>/<BOOK>_<CCC>.links.json per seeded chapter

Run in lexeme-aligner's venv (its tokenizer) with MAKE_TANAKH_WORK set (the toolkit's index of the Hebrew content words):
    cd $BCV_COMMONS/lexeme-aligner/pipeline && ../.venv/bin/python <this> ..."""
import argparse, collections, glob, json, os, re, sys
from datetime import date
from lexeme_aligner.usj_source import tokenize

sys.path.insert(0, os.path.join(os.environ["MAKE_TANAKH_WORK"], "scripts"))
import full_align as FA  # noqa: E402


def fnv1a(s):
    """FNV-1a 32-bit of the UTF-8 bytes, hex (the editor computes the same, src/lib/links.js)"""
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def seeded(seed):
    """{(book, chapter): {verse: text}} from the seed's chapter files (units joined with a space)"""
    out = {}
    for f in sorted(glob.glob(os.path.join(seed, "*", "*_*.tsv"))):
        book, ch = os.path.basename(f)[:3], int(os.path.basename(f)[4:7])
        verses = collections.OrderedDict()
        for line in open(f, encoding="utf-8"):
            if line.startswith("#") or not line.strip():
                continue
            ref, _, text = line.rstrip("\n").split("\t", 2)
            v = int(ref.split(":")[1])
            verses[v] = (verses[v] + " " + text) if v in verses else text
        out[(book, ch)] = verses
    return out


def text(a):
    S = seeded(a.seed)
    skip = {}
    for spec in a.skip:
        b, chs = spec.split(":"); skip[b] = {int(c) for c in chs.split(",")}
    os.makedirs(a.out, exist_ok=True)
    books = {b for b, _ in S} | {os.path.basename(f)[:3] for f in glob.glob(os.path.join(a.corpus, "*.txt"))}
    n = collections.Counter()
    for b in sorted(books):
        rows = {}
        cf = os.path.join(a.corpus, f"{b}.txt")
        if os.path.exists(cf):
            for line in open(cf, encoding="utf-8"):
                m = re.match(r"(\d+):(\d+) (.*)$", line.rstrip("\n"))
                if m:
                    rows[(int(m[1]), int(m[2]))] = m[3]; n["corpus verses"] += 1
        for (bb, ch), verses in S.items():
            if bb == b:
                for k in [k for k in rows if k[0] == ch]:
                    del rows[k]; n["corpus verses"] -= 1
                for v, t in verses.items():
                    rows[(ch, v)] = t; n["draft verses"] += 1
        for k in [k for k in rows if k[0] in skip.get(b, set())]:
            del rows[k]; n["left out"] += 1
        open(os.path.join(a.out, f"{b}.txt"), "w", encoding="utf-8").write("".join(f"{c}:{v} {t}\n" for (c, v), t in sorted(rows.items())))
    print(dict(n))


def parse(s):
    out = collections.defaultdict(list)
    for e in (s or "").split():
        o, _, sp = e.partition(":")
        if not o.isdigit() or not sp:
            continue
        for part in sp.split(","):
            x, _, y = part.partition("-")
            if x.isdigit() and (not y or y.isdigit()):
                out[int(o)] += list(range(int(x), int(y or x) + 1))
    return out


def layer(run, book):
    fs = [f for f in glob.glob(os.path.join(run, "compact", "*", "*", "*", f"{book}_*.json")) if os.path.basename(f).count(".") == 1]
    return json.load(open(fs[0], encoding="utf-8")) if fs else None


def spans(text, positions):
    """token positions (the aligner's tokens of the verse text) -> character ranges [start, end]"""
    out, cur, toks = [], 0, []
    for t in tokenize(text):
        j = text.find(t, cur)
        toks.append((j, j + len(t)) if j >= 0 else None)
        if j >= 0:
            cur = j + len(t)
    return [list(toks[p]) for p in sorted(set(positions)) if p < len(toks) and toks[p]]


def sidecars(a):
    S = seeded(a.seed)
    st = collections.Counter()
    for (book, ch), verses in S.items():
        L1, L2 = layer(a.run1, book), layer(a.run2, book)
        if L1 is None or L2 is None:
            print("no layer for", book, file=sys.stderr); continue
        refs = list(FA.index(book, "lexemes")); keys = FA.index(book, "keys")
        row = {r: i for i, r in enumerate(refs)}
        out = {}
        for v, t in verses.items():
            ref = f"{book} {ch}:{v}"; i = row.get(ref)
            ks = keys.get(ref, [])
            p1 = parse(L1[i]) if i is not None and i < len(L1) else {}
            p2 = parse(L2[i]) if i is not None and i < len(L2) else {}
            words = {}
            for o, k in enumerate(ks):
                a1, a2 = sorted(set(p1.get(o, []))), sorted(set(p2.get(o, [])))
                status = "unlinked" if not a1 and not a2 else "firm" if a1 == a2 else "check"
                w = words.setdefault(k[:11], {"status": status, "spans": []})
                rank = {"unlinked": 0, "firm": 1, "check": 2}
                if rank[status] > rank[w["status"]]:
                    w["status"] = status                 # a word of several morphemes: the least sure of them
                w["spans"] = sorted({tuple(x) for x in w["spans"]} | {tuple(x) for x in spans(t, a1 if status == "firm" else a1 + a2)})
                w["spans"] = [list(x) for x in w["spans"]]
            for w in words.values():
                st[w["status"]] += 1
            out[str(v)] = {"fp": fnv1a(t), "words": words}
        d = os.path.join(a.out, book); os.makedirs(d, exist_ok=True)
        json.dump({"spec": "make-tanakh-review links/1", "chapter": f"{book} {ch}", "made": date.today().isoformat(),
                   "method": "align-text eflomal chain, 2 runs", "verses": out},
                  open(os.path.join(d, f"{book}_{ch:03d}.links.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    tot = sum(st.values())
    print({k: f"{v} ({v / tot:.1%})" for k, v in st.items()}, "Hebrew content words in", len(S), "chapters")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("cmd", choices=["text", "sidecars"])
    ap.add_argument("--seed"); ap.add_argument("--corpus"); ap.add_argument("--out"); ap.add_argument("--skip", nargs="*", default=[])
    ap.add_argument("--run1"); ap.add_argument("--run2")
    a = ap.parse_args(); {"text": text, "sidecars": sidecars}[a.cmd](a)
