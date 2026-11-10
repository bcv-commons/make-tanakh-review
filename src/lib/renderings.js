// The draft's own rendering of each Hebrew word, from the chapter's .align (FORMAT.md section 2): the target words its main
// (content) or function link names, in text order. A word's morphemes are ordinals in compact-alignments' source index
// (poetry.js `ordinals`; a fused `a+b` is one ordinal); a word is its 11-digit id. Shared by the server and the browser.
import { tokenSpans } from "./format.js";
import { ordinals } from "./poetry.js";

// ordinal -> token positions, of one .align field ("0:3 1:2-3 2:4,6 !5 +7 ...")
export function links(field) {
  const out = new Map();
  for (const it of (field || "").split(" ")) {
    const m = /^(\d+):([\d,-]+)$/.exec(it);
    if (!m) continue;
    const toks = m[2].split(",").flatMap((x) => { const [a, b] = x.split("-").map(Number); return Array.from({ length: (b ?? a) - a + 1 }, (_, k) => a + k); });
    out.set(Number(m[1]), toks);
  }
  return out;
}

// { "<11-digit word id>": "the words" } for a chapter. ch: { book, verses: [{ ref, text }], align: Map verse -> { main, fn } };
// index: the book's source index ({ keys, fn }). Words with no link are left out.
export function renderings(index, ch) {
  const out = {};
  if (!index || !ch.align) return out;
  for (const { ref, text } of ch.verses) {
    const row = ch.align.get(Number(ref.split(":")[1]));
    if (!row) continue;
    const s = text.normalize("NFC");
    let spans;
    try { spans = tokenSpans(s); } catch { continue; }
    const L = { c: links(row.main), f: links(row.fn) }, byWord = new Map();
    for (const [id, [kind, o]] of Object.entries(ordinals(index, ch.book, ref))) {
      const toks = L[kind].get(o);
      if (!toks) continue;
      const w = id.slice(0, 11);
      if (!byWord.has(w)) byWord.set(w, new Set());
      for (const t of toks) byWord.get(w).add(t);
    }
    for (const [w, set] of byWord) {
      const words = [...set].sort((a, b) => a - b).filter((t) => t < spans.length).map((t) => s.slice(spans[t].start, spans[t].end));
      if (words.length) out[w] = words.join(" ");
    }
  }
  return out;
}

// The lexeme of each word of the given verses, from the source index's lexeme lists (compact-alignments `_index/<BOOK>_lexemes
// .json` beside `_keys.json`, `_fn.json` beside `_fn_keys.json`; published without the `hbo:`/`grc:` prefix, added here from
// the MACULA book number). A word's content morpheme's lexeme wins over its function morphemes'. { "<word id>": "hbo:0430" }
// The words that are function morphemes only (no content morpheme) are listed in the result's non-enumerable `fn` (a Set).
export function wordLexemes(index, book, refs) {
  const out = {}, fnOnly = new Set(), hasContent = new Set();
  Object.defineProperty(out, "fn", { value: fnOnly });
  if (!index || !index.lexemes) return out;
  for (const ref of refs) {
    const k = `${book} ${ref}`;
    for (const [keys, lex, content] of [[index.keys[k], index.lexemes[k], true], [index.fn[k], (index.fnLexemes || {})[k], false]]) {
      if (!keys || !lex) continue;
      keys.forEach((key, o) => {
        if (!lex[o]) return;
        for (const id of key.split("+").filter(Boolean)) {
          const w = id.slice(0, 11), pre = Number(id.slice(0, 2)) <= 39 ? "hbo:" : "grc:";
          if (content || !out[w]) out[w] = pre + lex[o];
          if (content) fnOnly.delete(w); else if (out[w] === pre + lex[o] && !hasContent.has(w)) fnOnly.add(w);
          if (content) hasContent.add(w);
        }
      });
    }
  }
  return out;
}

// The commonest renderings of a chapter's words: the language repo's `.tanakh/glosses.json` (FORMAT.md section 8) looked up
// through each word's lexeme, at most `n` forms. Alignment noise is trimmed: a form seen once, or under 5% of the lexeme's
// count, is dropped unless nothing else is left. { "<word id>": [[form, count], ...] }
export function trimForms(forms, n = 4) {
  const total = forms.reduce((a, [, c]) => a + c, 0) || 1;
  const kept = forms.filter(([, c]) => c >= 2 && c / total >= 0.05);
  return (kept.length ? kept : forms).slice(0, kept.length ? n : 1);
}
// From lexeme-aligner's table (lexeme-glosses/1, which has a `function` list), a function word (a word that is only a function
// morpheme in the source index) is given only when one form holds at least half of its count: their forms are less reliable, a
// word with no counterpart, such as אֵת, being linked to a neighbour. (Its `function` list names content words too, 2026-11-09.)
export function chapterGlosses(table, lexemes, n = 4) {
  const out = {};
  if (!table || !table.lexemes) return out;
  const strict = Array.isArray(table.function), fn = lexemes.fn || new Set();
  for (const [w, lex] of Object.entries(lexemes)) {
    const f = table.lexemes[lex];
    if (!f || !f.length) continue;
    if (strict && fn.has(w) && f[0][1] * 2 < f.reduce((a, [, c]) => a + c, 0)) continue;
    out[w] = trimForms(f, n);
  }
  return out;
}
