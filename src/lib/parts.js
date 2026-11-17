// Word parts (template/FORMAT.md section 12: `<BOOK>_<CCC>.parts`, make-tanakh-parts/1, derived, written by the publisher) for the
// editor's faint line under each clause. Server side: a row whose verse hash no longer matches the verse is stale and left out,
// so only verses as the parts were made show them. Only whole words are edited; the parts are never written here.
import crypto from "node:crypto";
import { tokenSpans } from "./format.js";

export const verseHash = (ref, text) => crypto.createHash("sha256").update(`${ref}\t${text}`, "utf8").digest("hex").slice(0, 8);

// One cell's pieces: [{ text, slot, morph }] in order; a tone piece `:tone[:<label>]@...` is { tone: label | "" } (its marks are
// already in the token the editor shows). null when a piece cannot be read.
export function pieces(cell) {
  const out = [];
  for (const p of cell.split("|")) {
    if (p.startsWith(":tone")) {
      const at = p.indexOf("@");
      if (at < 0) return null;
      out.push({ tone: p.slice(5, at).replace(/^:/, "") });
      continue;
    }
    const [text, slot, ...morph] = p.split(":");
    if (!text || !/^(whole|stem|[psi]\d+)$/.test(slot || "")) return null;
    out.push({ text, slot, morph: morph.join(":") || null });
  }
  return out;
}

// The chapter's parts per verse, for the verses whose text the rows were made from: { "c:v": { text, words: [{ start, end,
// pieces }] } }, one word per token of the standard tokeniser (start, end: offsets in `text`, the verse text they were made from;
// a verse not in NFC is left out, its offsets would not match). verses: [{ ref, text }] (the .md's).
export function wordParts(text, verses) {
  const out = {};
  if (!text || !/^# parts: make-tanakh-parts\/1;/.test(text)) return out;
  const byRef = new Map(verses.map((v) => [v.ref, v.text]));
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [ref, hash, ...cells] = line.split("\t");
    const vt = byRef.get(ref);
    if (vt == null || verseHash(ref, vt) !== hash || vt !== vt.normalize("NFC")) continue;   // stale, or not in the text
    let spans;
    try { spans = tokenSpans(vt); } catch { continue; }
    if (cells.length !== spans.length) continue;
    const words = [];
    for (let t = 0; t < cells.length; t++) {
      const m = /^(\d+)=(.+)$/.exec(cells[t]);
      const ps = m && Number(m[1]) === t ? pieces(m[2]) : null;
      if (!ps) { words.length = 0; break; }
      words.push({ start: spans[t].start, end: spans[t].end, pieces: ps });
    }
    if (words.length) out[ref] = { text: vt, words };
  }
  return out;
}
