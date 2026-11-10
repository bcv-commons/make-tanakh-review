#!/usr/bin/env python3
"""Seed make-tanakh-review with drafted chapters (PLAN.md sections 4-5): per chapter

  <out>/seed/<BOOK>/<BOOK>_<CCC>.tsv      the draft cut into clause units along the Hebrew clause layout (CC0 text + clause keys)
  (the Hebrew side of the editor is tools/build_hebrew.py: the same for every language, nothing from a draft)

The cuts follow the draft's own alignment (<code>NNN.align): each linked target token votes for the clause of its Hebrew word; a
dynamic programme cuts the verse's tokens into one contiguous group per clause, in order, with the fewest votes outside their
group. A clause with no tokens joins its neighbour (A+B). Joining the units with spaces must restore the verse text (checked).

    . ../make-tanakh-grammar/env.sh; ~/sil-study/.venv/bin/python tools/prepare_chapter.py \
        --draft $MAKE_TANAKH_WORK/export/dan/dan_BSB/jos --book JOS --chapters 1 2 --out .local

Reads $ALIGNER_DATA (hebrew-clause-layout, lexeme-spine-macula.db) and the work repo's toolkit (tokenize, the alignment index)."""
import argparse, collections, json, os, re, sqlite3, sys

sys.path.insert(0, os.path.join(os.environ["MAKE_TANAKH_WORK"], "scripts"))
import full_align as FA  # noqa: E402
import langtools as LT  # noqa: E402


def layout(book, chapter):
    import pyarrow.parquet as pq
    t = pq.read_table(os.path.join(os.environ["ALIGNER_DATA"], "hebrew-clause-layout", f"clauses-{book}.parquet"),
                      columns=["chapter", "verse", "seg", "clause_key", "kind", "rule", "words"])
    out = collections.defaultdict(list)
    for r in t.to_pylist():
        if r["chapter"] == chapter:
            out[r["verse"]].append(r)
    for v in out:
        out[v].sort(key=lambda r: r["seg"])
    return out


def spine(book, chapter):
    db = sqlite3.connect(os.path.join(os.environ["ALIGNER_DATA"], "lexeme-spine-macula.db"))
    rows = db.execute("select verse, key, surface, gloss, is_content from spine_words where book = ? and chapter = ? order by idx",
                      (book, chapter)).fetchall()
    return {k: (v, s, g, c) for v, k, s, g, c in rows}


def token_spans(text):
    """the toolkit's tokens with their character offsets in the text (found in order)"""
    spans, cur = [], 0
    for t in FA.tokenize(text):
        j = text.find(t, cur)
        if j < 0:
            return None
        spans.append((j, j + len(t))); cur = j + len(t)
    return spans


def cut(votes, n):
    """votes: per token the clause index it belongs to, or None -> group start positions (n groups, contiguous, in order)"""
    m = len(votes); INF = 10 ** 9
    # miss[i][k][j]: votes for clause i among tokens k..j-1 counted as misses when the group i covers k..j-1
    pre = [[0] * (m + 1) for _ in range(n)]
    for i in range(n):
        for j, v in enumerate(votes):
            pre[i][j + 1] = pre[i][j] + (v is not None and v != i)
    cost = [[INF] * (m + 1) for _ in range(n + 1)]; back = [[0] * (m + 1) for _ in range(n + 1)]
    cost[0][0] = 0
    for i in range(1, n + 1):
        for j in range(m + 1):
            for k in range(j + 1):
                c = cost[i - 1][k] + pre[i - 1][j] - pre[i - 1][k]
                if c < cost[i][j]:
                    cost[i][j], back[i][j] = c, k
    starts, j = [], m
    for i in range(n, 0, -1):
        k = back[i][j]; starts.append(k); j = k
    return starts[::-1]


def units_of(text, clauses, links, key_clause, st):
    """-> [(clause keys, text)] for one verse"""
    keys = [c["clause_key"] for c in clauses]
    spans = token_spans(text)
    if not clauses:
        st["verse without Hebrew clauses"] += 1; return [("", text)]
    if spans is None or len(clauses) == 1:
        if spans is None:
            st["verse kept whole (tokens not found)"] += 1
        return [("+".join(keys), text)]
    votes = [None] * len(spans)
    for key, ps in links.items():
        ci = key_clause.get(key)
        for p in ps:
            if ci is not None and p < len(votes):
                votes[p] = ci
    starts = cut(votes, len(clauses))
    groups = []                                            # [(clause indices, first token, end token)]
    for i, s in enumerate(starts):
        e = starts[i + 1] if i + 1 < len(starts) else len(spans)
        groups.append(([i], s, e))
    merged = []
    pending = []
    for ids, s, e in groups:                               # empty groups join the next non-empty one
        if s == e:
            pending += ids; continue
        merged.append((pending + ids, s, e)); pending = []
    if pending:
        if merged:
            merged[-1] = (merged[-1][0] + pending, merged[-1][1], merged[-1][2])
        else:
            return [("+".join(keys), text)]
    out = []
    for gi, (ids, s, e) in enumerate(merged):
        a = 0 if gi == 0 else cut_point(text, spans[s][0])
        b = len(text) if gi == len(merged) - 1 else cut_point(text, spans[merged[gi + 1][1]][0])
        out.append(("+".join(keys[i] for i in ids), text[a:b].strip()))
    if " ".join(t for _, t in out) != text or any(not t for _, t in out):
        st["verse kept whole (join check)"] += 1
        return [("+".join(keys), text)]
    st["units"] += len(out); st["joined units (A+B)"] += sum("+" in k for k, _ in out)
    return out


def cut_point(text, tok_start):
    """the cut before a token: just after the whitespace preceding it (opening quote marks stay with the token)"""
    j = tok_start
    while j > 0 and not text[j - 1].isspace():
        j -= 1
    return j


def main(a):
    st = collections.Counter()
    for ch in a.chapters:
        code = a.book.lower()
        txt = os.path.join(a.draft, f"{code}{ch:03d}.txt")
        V = LT.verses_of(txt)
        al = {}
        for line in open(os.path.join(a.draft, f"{code}{ch:03d}.align"), encoding="utf-8"):
            if line.startswith("#") or not line.strip():
                continue
            f = line.rstrip("\n").split("\t"); al[int(f[0])] = FA.parse(f[1])
        L = layout(a.book, ch); S = spine(a.book, ch)
        rows = []
        for (c, v), text in sorted(V.items()):
            if c != ch:
                continue
            text = re.sub(r"\s+", " ", text.replace("\t", " ")).strip()
            ref = f"{a.book} {c}:{v}"
            ckeys = FA.index(a.book, "keys").get(ref, [])
            links = {ckeys[o]: ps for o, ps in al.get(v, {}).items() if o < len(ckeys)}
            clauses = L.get(v, [])
            key_clause = {k: i for i, cl in enumerate(clauses) for k in cl["words"]}
            for keys, t in units_of(text, clauses, links, key_clause, st):
                rows.append(f"{c}:{v}\t{keys}\t{t}")
        for sub, name, body in (("seed", f"{a.book}_{ch:03d}.tsv",
                                 f"# {a.book} {ch} · make-tanakh-review clause units · CC0 · columns: verse, Hebrew clauses, text\n"
                                 + "\n".join(rows) + "\n"),):
            d = os.path.join(a.out, sub, a.book); os.makedirs(d, exist_ok=True)
            open(os.path.join(d, name), "w", encoding="utf-8").write(body)
        print(f"{a.book} {ch}: {len(rows)} units")
    print(dict(st))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--draft", required=True); ap.add_argument("--book", required=True)
    ap.add_argument("--chapters", type=int, nargs="+", required=True); ap.add_argument("--out", required=True)
    main(ap.parse_args())
