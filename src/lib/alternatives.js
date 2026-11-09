// Alternative drafts of a chapter (template/FORMAT.md section 9: `.tanakh/alternatives/<kind>/<BOOK>/<BOOK>_<CCC>.*`, written only
// by the publisher, never edited) and their agreement with the main text, computed from the current text every time (no stored
// counts: a stored copy goes stale with any edit). Shared by the server (reading) and the browser (the shading as the user types).
import { tokenSpans } from "./format.js";

export const ALT_FILE = /^\.tanakh\/alternatives\/([a-z0-9-]+)\/([A-Z0-9]{3})\/\2_(\d{3})\.(md|units|notes|align)$/;
export const ALT_DIR = ".tanakh/alternatives/";
export const altPath = (kind, mdPath, ext = "md") => `${ALT_DIR}${kind}/${mdPath.replace(/\.md$/, `.${ext}`)}`;

// A unit's clause: its key without the layout's `/n` segment and the translator's `.n` split ("A-B/2.2" -> "A-B")
export const clauseOf = (key) => { const m = /^\d+-\d+/.exec(key); return m ? m[0] : key; };

// Tokens for the comparison: the standard tokeniser (FORMAT.md section 1), each lower-cased and NFC
const norm = (t) => t.toLowerCase().normalize("NFC");

// `.tanakh/alternatives/README.md`: { kind: "the line" } from its lines "- `<kind>` (<BOOK> <chapters>): <generator>; built <date>"
export function readmeLines(text) {
  const out = {};
  for (const l of (text || "").split("\n")) { const m = /^-\s+`([a-z0-9-]+)`\s*(.*)$/.exec(l.trim()); if (m) (out[m[1]] ||= []).push(l.trim().slice(2)); }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join("\n")]));
}

// An alternative's words per verse, from its verse texts and .units rows: { "c:v": [{ clause, text, words }] }, one entry per unit
// with words (a `=` unit has none of its own and gives none: FORMAT.md section 9). `text` is what the unit's ranges cover.
export function altUnits(verses, unitRows) {
  const out = {};
  for (const { ref, text } of verses) {
    const list = unitRows.get(ref);
    if (!list) continue;
    const s = text.normalize("NFC");
    let spans;
    try { spans = tokenSpans(s); } catch { continue; }
    const units = [];
    for (const u of list) {
      if (!u.ranges) continue;
      const ok = u.ranges.filter(([a, b]) => a <= b && b < spans.length);
      if (!ok.length) continue;
      units.push({ clause: clauseOf(u.key), text: ok.map(([a, b]) => s.slice(spans[a].start, spans[b].end)).join(" … "),
        words: ok.flatMap(([a, b]) => spans.slice(a, b + 1).map((t) => norm(t.text))) });
    }
    out[ref] = units;
  }
  return out;
}

// What each alternative has for one main unit ({ ref, bases, text }): the units of the same verse whose clause is one of the
// unit's clauses (a main unit renders the clauses of its `=` keys too: its bases). [{ kind, about, units: [...], words: Set|null }]
export function forUnit(alts, u) {
  const clauses = new Set(u.bases.map(clauseOf));
  return (alts || []).map((a) => {
    const units = ((a.verses || {})[u.ref] || []).filter((x) => clauses.has(x.clause));
    return { kind: a.kind, about: a.about, units, words: units.length ? new Set(units.flatMap((x) => x.words)) : null };
  });
}

// The agreement of a main unit's tokens with the alternatives (FORMAT.md section 9): for each token { start, end, support, kinds }
// (offsets in the NFC text), `available` = how many alternatives have words for the unit's clauses. Exact membership after
// lower-casing; each token on its own (a set, not counts); nothing crosses a verse.
export function agreement(alts, u) {
  const have = forUnit(alts, u).filter((a) => a.words);
  let spans = [];
  try { spans = tokenSpans(u.text.normalize("NFC")); } catch { /* not tokenisable: no shading */ }
  return { available: have.length, tokens: spans.map((t) => {
    const kinds = have.filter((a) => a.words.has(norm(t.text))).map((a) => a.kind);
    return { start: t.start, end: t.end, support: kinds.length, kinds };
  }) };
}

// The shading of a token: "none" (all agree, or nothing to compare), "some" (some alternatives have it), "nil" (none has it)
export const shade = (available, support) => (!available || support === available ? "none" : support === 0 ? "nil" : "some");
