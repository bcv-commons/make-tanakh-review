// Poetry lines (template/FORMAT.md section 5): the source's line breaks, kept once per book in `.tanakh/poetry/<BOOK>.json`
// keyed by the Hebrew word before which a line begins, placed in a translation through its alignment. A line keyed `clause`
// begins where the unit of that clause begins (.units); any other line begins before the first target token linked to its
// word (.align). The word's .align ordinal is its place in the verse's list in compact-alignments' source index
// (`_index/<BOOK>_keys.json` content words, `_fn_keys.json` function words; a fused token `a+b` is one ordinal). A line that
// cannot be placed is left out, and a verse with none placed is prose: the correct fallback. Shared by the server and the browser.
import { tokenSpans, cutOffset } from "./format.js";

// "c:v" of a 12-digit MACULA Hebrew word id (book 2, chapter 3, verse 3, word 3, part 1)
export const wordRef = (id) => `${Number(id.slice(2, 5))}:${Number(id.slice(5, 8))}`;

// { id: ["c" | "f", ordinal] } for one verse from the source index ({ keys, fn }: "BOOK c:v" -> [key, ...])
export function ordinals(index, book, ref) {
  const out = {};
  for (const [list, kind] of [[index.keys[`${book} ${ref}`], "c"], [index.fn[`${book} ${ref}`], "f"]])
    (list || []).forEach((k, o) => { for (const id of (k || "").split("+").filter(Boolean)) out[id] = [kind, o]; });
  return out;
}

// the target tokens an .align field links to ordinal o
function linked(field, o) {
  for (const it of (field || "").split(" ")) {
    const m = /^(\d+):([\d,-]+)$/.exec(it);
    if (m && Number(m[1]) === o) return m[2].split(",").map((x) => Number(x.split("-")[0]));
  }
  return [];
}

// A line begins with the target words just before its word that render nothing of their own (`Og` for the וְ of a verb, an
// added word, ...): the break moves back over tokens no link names, but not over an added word that belongs to an earlier
// Hebrew word (`+pos>ord`).
function backOver(at, row, ords, id) {
  const linkedPos = new Set(), owner = new Map();
  for (const it of `${row.main} ${row.fn}`.split(" ")) {
    let m;
    if ((m = /^\d+:([\d,-]+)$/.exec(it)))
      for (const x of m[1].split(",")) { const [a, b] = x.split("-").map(Number); for (let i = a; i <= (b ?? a); i++) linkedPos.add(i); }
    else if (it.startsWith("+"))
      for (const x of it.slice(1).split(",")) { const [p, o] = x.split(">"); if (o) owner.set(Number(p), o.startsWith("f") ? ["f", Number(o.slice(1))] : ["c", Number(o)]); }
  }
  const idOf = ([kind, o]) => Object.keys(ords).find((k) => ords[k][0] === kind && ords[k][1] === o);
  while (at > 0 && !linkedPos.has(at - 1)) {
    const o = owner.get(at - 1), oid = o && idOf(o);
    if (oid && oid.slice(0, 11) < id.slice(0, 11)) break;
    at--;
  }
  return at;
}

// The breaks of a chapter: { "c:v": [{ at, level }] } (at = the token the line begins with), and how many lines were placed.
// entries: the book's poetry lines [[id, level, how]]; ch: { book, chapter, units (Map ref -> units rows), align (Map v ->
// row) | null }; index: the book's source index or null (then only clause-keyed lines are placed).
export function chapterBreaks(entries, ch, index) {
  const out = {};
  let placed = 0, missed = 0;
  const mine = (entries || []).filter(([id]) => Number(wordRef(id).split(":")[0]) === ch.chapter);
  const inVerse = new Map();
  for (const e of mine) { const r = wordRef(e[0]); if (!inVerse.has(r)) inVerse.set(r, []); inVerse.get(r).push(e[0]); }
  for (const list of inVerse.values()) list.sort();
  for (const [id, level, how] of mine) {
    const ref = wordRef(id);
    let at = null;
    if (how === "clause") {
      const u = (ch.units.get(ref) || []).find((x) => x.key.startsWith(`${id}-`) && !x.seg && !x.part && x.ranges);
      if (u) at = u.ranges[0][0];
    }
    if (at == null && index && ch.align) {
      // The line's words in the Hebrew: from the start of the clause its word is in (unless another line begins in between) up
      // to the next line's word, whole words (the first 11 digits). A line keyed by the word that renders the source
      // translation's first word need not begin with it in another word order ("Velsignet er du" for בָּרוּךְ אַתָּה, keyed
      // by אַתָּה): it begins with the first target word any of its Hebrew words is linked to.
      const ords = ordinals(index, ch.book, ref), row = ch.align.get(Number(ref.split(":")[1]));
      const keys = inVerse.get(ref), i = keys.indexOf(id), word = (k) => k.slice(0, 11);
      const clause = (ch.units.get(ref) || []).map((u) => u.key.split("-")).find(([a, b]) => a <= id && id <= b);
      const prev = i > 0 ? word(keys[i - 1]) : "";
      const from = clause && word(clause[0]) > prev ? word(clause[0]) : word(id), to = i + 1 < keys.length ? word(keys[i + 1]) : "~";
      const toksOf = (k) => (row ? linked(ords[k][0] === "c" ? row.main : row.fn, ords[k][1]) : []);
      const toks = Object.keys(ords).filter((k) => word(k) >= from && word(k) < to).flatMap(toksOf);
      if (toks.length) at = backOver(Math.min(...toks), row, ords, from);
    }
    if (at == null) { missed++; continue; }
    placed++;
    const list = (out[ref] ||= []);
    const same = list.find((b) => b.at === at);
    if (same) same.level = Math.min(same.level, level);
    else list.push({ at, level });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.at - b.at);
  return { breaks: out, placed, missed };
}

// A verse as poetry lines: [{ level, text }], level 0 for text before the verse's first break (it continues the line before).
export function poemLines(text, breaks) {
  const s = text.normalize("NFC"), spans = tokenSpans(s), out = [];
  const cuts = (breaks || []).map((b) => ({ ...b, off: cutOffset(s, spans, b.at) })).filter((b, i, a) => i === 0 || b.off > a[i - 1].off);
  if (!cuts.length || cuts[0].off > 0) out.push({ level: 0, from: 0 });
  for (const c of cuts) out.push({ level: c.level, from: c.off });
  return out.map((l, i) => ({ level: l.level, text: s.slice(l.from, i + 1 < out.length ? out[i + 1].from : s.length).trim() })).filter((l) => l.text);
}
