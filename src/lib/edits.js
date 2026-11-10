// The edit records of a save (template/FORMAT.md section 10; agreed with make-tanakh-grammar 2026-11-10): what a reviewer changed,
// as structured rows the drafting side learns from. One file per save, `.tanakh/edits/<BOOK>/<BOOK>_<CCC>/<time>-<login>.jsonl`,
// written in the same commit as the chapter, so it reaches main only when the proposal is merged. Rows are classified here
// from what the save knows (the token diff, the "use" button, splits and joins, the .align function links); AFFIX is the
// drafting side's, at intake (it needs the word's parts).
import { tokenSpans } from "./format.js";
import { links } from "./renderings.js";
import { clauseOf } from "./alternatives.js";

export const EDITS_DIR = ".tanakh/edits/";
export const EDITS_FILE = /^\.tanakh\/edits\/([A-Z0-9]{3})\/\1_(\d{3})\/(\d{8}T\d{6}Z)-([A-Za-z0-9-]+)\.jsonl$/;
export const OPS = ["M", "R", "U", "WO"];             // ERRANT's: missing (added), replaced, unnecessary (removed), word order
export const CATS = ["SPELL", "TONE", "AFFIX", "FUNC", "WORD", "NEW", "ORDER", "SPLIT", "JOIN", "CHOICE", "OTHER"];

export const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
export const editsPath = (mdPath, when, login) => `${EDITS_DIR}${mdPath.replace(/\.md$/, "")}/${stamp(when)}-${login}.jsonl`;

const bare = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
const lower = (s) => s.toLowerCase().normalize("NFC");

function distance(a, b) {
  const A = Array.from(a), B = Array.from(b);
  let prev = Array.from({ length: B.length + 1 }, (_, j) => j);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[B.length];
}

// the tokens of a verse with their surfaces (the text they cover, marks included: the tokeniser drops combining marks, so a
// tone mark changes the surface but not the token)
function toks(text) {
  const s = (text || "").normalize("NFC");
  try { return { s, t: tokenSpans(s).map((x) => ({ ...x, w: s.slice(x.start, x.end) })) }; } catch { return { s, t: [] }; }
}

// the differing stretches of two token lists, by the longest common subsequence of their surfaces without case: [{ i0, i1, j0,
// j1 }], and the matched pairs whose case differs ([[i, j]]: a SPELL row, unless it is only a sentence's capital moving)
function hunks(a, b) {
  const n = a.length, m = b.length, L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  const eq = (i, j) => lower(a[i].w) === lower(b[j].w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = eq(i, j) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [], cased = [];
  let i = 0, j = 0, open = null;
  const close = () => { if (open) { out.push({ ...open, i1: i, j1: j }); open = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && eq(i, j)) { close(); if (a[i].w !== b[j].w) cased.push([i, j]); i++; j++; continue; }
    open ||= { i0: i, j0: j };
    if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) j++; else i++;
  }
  close();
  out.cased = cased;
  return out;
}

// a token that begins a sentence: the verse's first, or after . ! ? : or an opening quote mark
const sentenceStart = (v, t) => t === 0 || /[.!?:»«>"“”‘’]\s*$/.test(v.s.slice(t ? v.t[t - 1].end : 0, v.t[t].start));

// one replaced word: TONE (only its marks differ), SPELL (case, or a small edit distance), FUNC (the old word was a function
// word's rendering in the .align), NEW (the new word is not known in the language: the glosses' forms, the chapter), WORD
function wordCat(o, n, fn, vocab) {
  if (bare(o) === bare(n)) return "TONE";
  const d = distance(lower(o), lower(n));
  if (d === 0 || d <= Math.max(1, Math.floor(Math.max(o.length, n.length) / 4))) return "SPELL";
  if (fn) return "FUNC";
  return vocab.has(lower(n)) ? "WORD" : "NEW";
}

const slice = (v, a, b) => (a < b ? v.s.slice(v.t[a].start, v.t[b - 1].end) : "");
const quote = (v, a, b) => ({ prefix: v.t.slice(Math.max(0, a - 3), a).map((x) => x.w).join(" "), suffix: v.t.slice(b, b + 3).map((x) => x.w).join(" ") });

// The unit (its id as the .units file writes it) that holds token t of a verse's .units row
function unitAt(row, t) {
  let last = null;
  for (const u of row || []) {
    if (!u.ranges) continue;
    if (u.ranges.some(([a, b]) => t >= a && t <= b)) return `${u.key}${u.seg}${u.part}`;
    if (u.ranges[0][0] <= t) last = `${u.key}${u.seg}${u.part}`;
  }
  return last;
}

// The rows of one save. before/after: chapter models (chapter.js readChapter); who, when (a Date); uses: [{ ref, bases, kind }]
// (the "use" button since the last save); vocab: a Set of known lower-case words; commit: the commit the edit was made on.
export function editRows({ before, after, who, when, uses = [], vocab = new Set(), commit = null }) {
  const rows = [], at = when.toISOString();
  const base = { who, when: at, scope: "this", entry: null, draft: null, why: null, commit };
  const textOf = (ch, ref) => ch.verses.find((v) => v.ref === ref)?.text;
  for (const { ref } of after.verses) {
    const o = textOf(before, ref), n = textOf(after, ref);
    const row = after.units.verses.get(ref);
    const used = uses.filter((u) => u.ref === ref);
    const fromAlt = (unit) => (unit && used.find((u) => u.bases.map(clauseOf).includes(clauseOf(unit)))?.kind) || null;
    if (o !== undefined && n !== undefined && o !== n) {
      const A = toks(o), B = toks(n);
      const fnRow = before.align?.rows.get(Number(ref.split(":")[1]));
      const fnToks = new Set(fnRow && !before.stale.align ? [...links(fnRow.fn).values()].flat() : []);
      const hs = hunks(A.t, B.t), done = new Set();
      for (const [i, j] of hs.cased) {
        if (sentenceStart(A, i) !== sentenceStart(B, j)) continue;       // the capital went with the sentence's first word
        const unit = unitAt(row, j);
        rows.push({ ref, unit, ...base, op: "R", cat: "SPELL", span: { old: [i, i + 1], new: [j, j + 1] }, old: A.t[i].w, new: B.t[j].w,
          quote: quote(B, j, j + 1), from_alt: fromAlt(unit) });
      }
      // a stretch removed in one place and the same words added in another: one word-order row
      hs.forEach((h, k) => {
        if (done.has(k) || h.i1 - h.i0 === 0 || h.j1 - h.j0 !== 0) return;
        const words = slice(A, h.i0, h.i1);
        const bag = (list) => list.map((t) => lower(t.w)).sort().join("\u0000"), want = bag(A.t.slice(h.i0, h.i1));
        const k2 = hs.findIndex((g, x) => !done.has(x) && g.i1 - g.i0 === 0 && g.j1 - g.j0 === h.i1 - h.i0 && bag(B.t.slice(g.j0, g.j1)) === want);
        if (k2 < 0 || !words) return;
        const g = hs[k2], unit = unitAt(row, g.j0);
        done.add(k); done.add(k2);
        rows.push({ ref, unit, ...base, op: "WO", cat: "ORDER", span: { old: [h.i0, h.i1], new: [g.j0, g.j1] }, old: words, new: slice(B, g.j0, g.j1),
          quote: quote(B, g.j0, g.j1), from_alt: fromAlt(unit) });
      });
      hs.forEach((h, k) => {
        if (done.has(k)) return;
        const no = h.i1 - h.i0, nn = h.j1 - h.j0, unit = unitAt(row, nn ? h.j0 : Math.max(0, h.j0 - 1));
        const ow = A.t.slice(h.i0, h.i1), nw = B.t.slice(h.j0, h.j1);
        let op, cat;
        if (!no) { op = "M"; cat = nw.every((t) => vocab.has(lower(t.w))) ? "WORD" : "NEW"; }
        else if (!nn) { op = "U"; cat = ow.every((t, y) => fnToks.has(h.i0 + y)) ? "FUNC" : "WORD"; }
        else if (no > 1 && no === nn && ow.map((t) => lower(t.w)).sort().join("\u0000") === nw.map((t) => lower(t.w)).sort().join("\u0000")) { op = "WO"; cat = "ORDER"; }
        else {
          op = "R";
          const each = no === nn ? ow.map((t, y) => wordCat(t.w, nw[y].w, fnToks.has(h.i0 + y), vocab)) : null;
          cat = each && each.every((c) => c === each[0]) ? each[0]
            : ow.every((t, y) => fnToks.has(h.i0 + y)) ? "FUNC" : nw.every((t) => vocab.has(lower(t.w))) ? "WORD" : "NEW";
        }
        rows.push({ ref, unit, ...base, op, cat, span: { old: [h.i0, h.i1], new: [h.j0, h.j1] }, old: slice(A, h.i0, h.i1), new: slice(B, h.j0, h.j1),
          quote: quote(B, h.j0, h.j1), from_alt: fromAlt(unit) });
      });
      // punctuation or spacing only: the changed stretch of characters
      if (!hs.length && !rows.some((r) => r.ref === ref && r.cat === "SPELL")) {
        let p = 0; while (p < o.length && p < n.length && o[p] === n[p]) p++;
        let q = 0; while (q < o.length - p && q < n.length - p && o[o.length - 1 - q] === n[n.length - 1 - q]) q++;
        rows.push({ ref, unit: null, ...base, op: "R", cat: "OTHER", span: null, old: o.slice(p, o.length - q), new: n.slice(p, n.length - q),
          quote: { prefix: n.slice(Math.max(0, p - 20), p), suffix: n.slice(n.length - q, n.length - q + 20) }, from_alt: null });
      }
    }
    // the clause cut: a unit split in two, two units joined
    const cuts = (ch) => ch.list.filter((u) => u.ref === ref).map((u) => u.bases.join("+"));
    const cb = cuts(before), ca = cuts(after);
    if (cb.join(" ") !== ca.join(" ")) {
      rows.push({ ref, unit: null, ...base, op: "R", cat: ca.length > cb.length ? "SPLIT" : ca.length < cb.length ? "JOIN" : "OTHER", span: null,
        old: cb.join(" | "), new: ca.join(" | "), quote: null, from_alt: null });
    }
  }
  return rows;
}

// The rows of a merge where the author chose per verse (conflicts: [{ file, ref, ours, theirs }], ours = their proposal, theirs =
// main): which version they kept. { "<chapter .md>": [row, ...] }
export function choiceRows(conflicts, choices, { who, when, commit = null }) {
  const out = {};
  for (const c of conflicts) {
    const pick = (choices[c.file] || {})[c.ref] === "theirs" ? "theirs" : "ours";
    const text = (l) => l.map((u) => u.text.trim()).join(" ");
    (out[c.file] ||= []).push({ ref: c.ref, unit: null, who, when: when.toISOString(), op: "R", cat: "CHOICE", choice: pick, span: null,
      old: text(pick === "ours" ? c.theirs : c.ours), new: text(pick === "ours" ? c.ours : c.theirs), quote: null, scope: "this",
      from_alt: null, entry: null, draft: null, why: null, commit });
  }
  return out;
}

export const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

// The known words of a language for NEW: the forms of its glosses table, and the words of the chapter as it was
export function vocabulary(table, ...chapters) {
  const v = new Set();
  for (const forms of Object.values((table && table.lexemes) || {})) for (const [f] of forms) for (const w of String(f).split(/\s+/)) v.add(lower(w));
  for (const ch of chapters) for (const { text } of ch ? ch.verses : []) for (const t of toks(text).t) v.add(lower(t.w));
  return v;
}
