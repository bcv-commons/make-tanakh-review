// The chapter format of the language repos (template/FORMAT.md), shared by the browser and the server: the standard tokeniser
// (vendored), the input of the text hash, and the four chapter files (.md text, .units clause units, .notes inline notes, .align alignment).
// Parsing keeps everything it does not interpret, so a file read and written back unchanged is byte for byte the same.

// ---- the standard tokeniser: the published reference, vendored unchanged (src/lib/vendor/tokenize.js, CC0, from the
// bcv-commons/compact-alignments dataset). Its version must be the one the dataset's manifest names.
import { tokenize as refTokenize, stripMarks, TOKENIZER_VERSION as VENDORED } from "./vendor/tokenize.js";

export const TOKENIZER_VERSION = 3;   // compact-alignments manifest.json tokenizer_version (checked 2026-11-02)
if (VENDORED !== TOKENIZER_VERSION) throw new Error(`tokenize.js implements tokenizer v${VENDORED}, the dataset uses v${TOKENIZER_VERSION}`);

export const tokenize = refTokenize;

// The tokens of a text with where they stand in its NFC form: [{ text, start, end }] (UTF-16 offsets, end exclusive). The tokens
// are the reference tokeniser's; the offsets are found by reading them off the text in order, skipping the marks it drops (a
// token's span includes the marks dropped inside it). Digits and punctuation are separators and belong to no token.
export function tokenSpans(text) {
  const s = text.normalize("NFC");
  const chars = [];
  for (let at = 0; at < s.length;) { const ch = String.fromCodePoint(s.codePointAt(at)); chars.push({ ch, at, kept: stripMarks(ch) === ch }); at += ch.length; }
  const out = [];
  let i = 0;
  for (const tok of refTokenize(s)) {
    const want = Array.from(tok);
    for (;; i++) {
      if (i >= chars.length) throw new Error(`tokenSpans: token ${tok} not found`);
      if (!chars[i].kept || chars[i].ch !== want[0]) continue;
      let j = i, k = 0;
      while (j < chars.length && k < want.length) { if (!chars[j].kept) { j++; continue; } if (chars[j].ch !== want[k]) break; j++; k++; }
      if (k < want.length) continue;
      while (j < chars.length && !chars[j].kept && /\p{M}/u.test(chars[j].ch)) j++;   // dropped marks right after the token
      out.push({ text: tok, start: chars[i].at, end: j < chars.length ? chars[j].at : s.length });
      i = j;
      break;
    }
  }
  return out;
}

// Where a piece of the text that begins with token t starts (s the NFC text, spans its tokenSpans): after the last white space
// before the token, so opening punctuation (>>, «, ...) goes with it; 0 for the first token, the end for a token past the last.
export function cutOffset(s, spans, t) {
  if (t <= 0) return 0;
  if (!spans[t]) return s.length;
  const from = spans[t - 1].end, gap = s.slice(from, spans[t].start), ws = gap.search(/\s\S*$/);
  return ws < 0 ? spans[t].start : from + ws + 1;
}

// Verse text as the converter writes it (the hash is over the raw text): white space runs collapsed to one space, no leading
// or trailing space, no tab or newline inside.
export const cleanText = (t) => String(t).replace(/\s+/g, " ").trim();

// The input of a chapter's text hash (FORMAT.md section 2; the toolkit's text_hash): every verse line as `c:v:text` (chapter
// and verse as integers, the text raw, not tokenised), sorted numerically by chapter and verse, joined by "\n" with no newline
// at the end. Its SHA-256 (UTF-8, lowercase hex) is the `# text` line of every sidecar.
export function hashInput(verses) {
  return [...verses].sort((a, b) => refKey(a.ref) - refKey(b.ref)).map((v) => `${v.ref}:${v.text}`).join("\n");
}

export function refKey(ref) {
  const [c, v] = String(ref).split(":").map(Number);
  return c * 1000 + v;
}

const VERSE = /^(\d+):(\d+)\t(.*)$/;

// ---- <BOOK>_<CCC>.md: { front: [lines between the --- lines], lines: [{ kind: "title" | "heading" | "verse" | "blank", ... }] }
export function parseMd(text) {
  const all = text.replace(/\n$/, "").split("\n");
  const errors = [];
  let i = 0;
  const front = [];
  if (all[0] === "---") {
    const end = all.indexOf("---", 1);
    if (end < 0) errors.push("front matter: no closing ---");
    else { front.push(...all.slice(1, end)); i = end + 1; }
  } else errors.push("no front matter");
  const lines = [];
  let last = 0;
  const seen = new Set();
  for (; i < all.length; i++) {
    const l = all[i], n = i + 1;
    let m;
    if ((m = VERSE.exec(l))) {
      const ref = `${Number(m[1])}:${Number(m[2])}`, k = refKey(ref);
      if (seen.has(ref)) errors.push(`line ${n}: verse ${ref} twice`);
      else if (k < last) errors.push(`line ${n}: verse ${ref} out of order`);
      seen.add(ref); last = Math.max(last, k);
      lines.push({ kind: "verse", ref, raw: m[1] + ":" + m[2], text: m[3] });
    } else if (l.startsWith("## ")) lines.push({ kind: "heading", text: l.slice(3) });
    else if (l.startsWith("# ")) lines.push({ kind: "title", text: l.slice(2) });
    else if (l === "") lines.push({ kind: "blank" });
    else { errors.push(`line ${n}: not a verse, title or heading`); lines.push({ kind: "other", text: l }); }
  }
  return { front, lines, errors };
}

export function serializeMd(md) {
  const body = md.lines.map((l) => l.kind === "verse" ? `${l.raw || l.ref}\t${l.text}` : l.kind === "heading" ? `## ${l.text}`
    : l.kind === "title" ? `# ${l.text}` : l.kind === "blank" ? "" : l.text);
  return ["---", ...md.front, "---", ...body].join("\n") + "\n";
}

export const mdVerses = (md) => md.lines.filter((l) => l.kind === "verse").map((l) => ({ ref: l.ref, text: l.text }));

// The status fields of the front matter (values are JSON strings): { maturity: "...", ... } and the labels.
export function mdStatus(md) {
  const status = {};
  let labels = [], inStatus = false;
  for (const l of md.front) {
    if (/^status:\s*$/.test(l)) { inStatus = true; continue; }
    const m = /^ {2}(\w+):\s*(.*)$/.exec(l);
    if (inStatus && m) { status[m[1]] = readJson(m[2]); continue; }
    inStatus = false;
    const lab = /^status_labels:\s*(.*)$/.exec(l);
    if (lab) labels = readJson(lab[1]) || [];
  }
  return { status, labels };
}

function readJson(s) { try { return JSON.parse(s); } catch { return s; } }

// ---- sidecars: a header of `# ` lines (one of them `# text <sha256>`), then rows keyed by verse
function splitHeader(text) {
  const header = [], rows = [];
  for (const l of text.replace(/\n$/, "").split("\n")) {
    if (!rows.length && l.startsWith("#")) header.push(l);
    else if (l !== "") rows.push(l);
  }
  return { header, rows };
}

export const headerHash = (header) => (header.find((l) => l.startsWith("# text ")) || "").slice(7).trim() || null;
export const withHash = (header, hash) => {
  const i = header.findIndex((l) => l.startsWith("# text "));
  return i < 0 ? [...header, `# text ${hash}`] : header.map((l, j) => (j === i ? `# text ${hash}` : l));
};

// .units: per verse [{ key, seg, part, ranges: [[a, b], ...] | null }] (null = `:=`, no words of its own). `key` is the span
// `first-last`; `seg` "/2" the layout's own segment, `part` ".2" a translator's split.
const UNIT = /^(\d+-\d+)(\/\d+)?(\.\d+)?:(=|\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)$/;

export function parseUnits(text) {
  const { header, rows } = splitHeader(text);
  const verses = new Map(), errors = [];
  for (const r of rows) {
    const [ref, items = ""] = r.split("\t");
    const list = [];
    for (const it of items.split(" ").filter(Boolean)) {
      const m = UNIT.exec(it);
      if (!m) { errors.push(`${ref}: cannot read ${it}`); continue; }
      list.push({ key: m[1], seg: m[2] || "", part: m[3] || "",
        ranges: m[4] === "=" ? null : m[4].split(",").map((x) => { const [a, b] = x.split("-").map(Number); return [a, b ?? a]; }) });
    }
    verses.set(ref, list);
  }
  return { header, verses, errors };
}

export const unitId = (u) => `${u.key}${u.seg}${u.part}`;
const rangeText = (ranges) => ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(",");

export function serializeUnits({ header, verses }) {
  const rows = [...verses].sort((a, b) => refKey(a[0]) - refKey(b[0]))
    .map(([ref, list]) => `${ref}\t${list.map((u) => `${unitId(u)}:${u.ranges ? rangeText(u.ranges) : "="}`).join(" ")}`);
  return [...header, ...rows].join("\n") + "\n";
}

// .notes: [{ ref, kind, anchor, text }]
export function parseNotes(text) {
  const { header, rows } = splitHeader(text);
  const notes = [], errors = [];
  for (const r of rows) {
    const [ref, kind, anchor, ...rest] = r.split("\t");
    if (!VERSE.test(`${ref}\t`) || !/^\d+$/.test(anchor || "")) { errors.push(`cannot read note: ${r}`); continue; }
    notes.push({ ref, kind, anchor: Number(anchor), text: rest.join("\t") });
  }
  return { header, notes, errors };
}

export function serializeNotes({ header, notes }) {
  return [...header, ...notes.map((n) => `${n.ref}\t${n.kind}\t${n.anchor}\t${n.text.replace(/[\t\n\r]+/g, " ")}`)].join("\n") + "\n";
}

// .align: rows `verse<TAB>main links<TAB>function links<TAB>profile`, kept as they are; read for the profile letter and the
// target token positions. { header, rows: Map(verse -> { main, fn, profile }) }
export const PROFILES = { a: "script", b: "agent", h: "checked", j: "Jev", s: "re-projected" };

export function parseAlign(text) {
  const { header, rows } = splitHeader(text);
  const out = new Map();
  for (const r of rows) {
    const [v, main = "", fn = "", profile = ""] = r.split("\t");
    out.set(Number(v), { main, fn, profile });
  }
  return { header, rows: out };
}

export function serializeAlign({ header, rows }) {
  return [...header, ...[...rows].sort((a, b) => a[0] - b[0]).map(([v, r]) => `${v}\t${r.main}\t${r.fn}\t${r.profile}`)].join("\n") + "\n";
}

// The items of an .align field: `ord:5-7,9` a link, `!ords` no target word, `u`/`e ord[@slot],...` untranslated / rendered
// elsewhere (slot an anchor, negative = none), `+pos[>[f]ord],...` added target words with the Hebrew word each belongs to.
const RANGES = "\\d+(?:-\\d+)?(?:,\\d+(?:-\\d+)?)*";
export const ALIGN_ITEM = new RegExp(`^(?:\\d+:${RANGES}|!${RANGES}|[ue]\\d+(?:@-?\\d+)?(?:,\\d+(?:@-?\\d+)?)*|\\+\\d+(?:>f?\\d+)?(?:,\\d+(?:>f?\\d+)?)*)$`);

// every target token position a row names (links `ord:5-7,9` and added words `+5`, `+5>2,7`)
export function alignPositions(row) {
  const out = [];
  for (const part of `${row.main} ${row.fn}`.split(" ").filter(Boolean)) {
    let m;
    if ((m = /^\d+:([\d,-]+)$/.exec(part)))
      for (const x of m[1].split(",")) { const [a, b] = x.split("-").map(Number); for (let i = a; i <= (b ?? a); i++) out.push(i); }
    else if (part.startsWith("+")) for (const x of part.slice(1).split(",")) out.push(Number(x.split(">")[0]));
  }
  return out;
}
