// A chapter of a language repo as the editor sees it (template/FORMAT.md; PLAN.md sections 15.2 point 8 and 16.5), on the server:
// the four files read into one model, the clause units the editor shows (the verse text cut at the .units token ranges), the
// files built back from edited units with every `# text` hash recomputed, and the verse-by-verse three-way merge.
import crypto from "node:crypto";
import {
  parseMd, serializeMd, mdVerses, parseUnits, serializeUnits, parseNotes, serializeNotes, parseAlign, serializeAlign,
  tokenSpans, tokenize, cleanText, hashInput, headerHash, withHash, refKey, cutOffset,
} from "./format.js";
import { projection, projectAnchor, projectRow } from "./align.js";
import { byVerse } from "./units.js";

export const EXTS = ["md", "units", "notes", "align"];
export const CHAPTER_FILE = /^([A-Z0-9]{3})\/\1_(\d{3})\.(md|units|notes|align)$/;
export const sibling = (mdPath, ext) => mdPath.replace(/\.md$/, `.${ext}`);
export const chapterOf = (file) => { const m = CHAPTER_FILE.exec(file); return m ? `${m[1]}/${m[1]}_${m[2]}.md` : null; };

export const textHash = (verses) => crypto.createHash("sha256").update(hashInput(verses), "utf8").digest("hex");

// texts: { md, units, notes, align } (strings, or null where the file is missing). The .md and .units are required.
export function readChapter(texts) {
  if (!texts.md || !texts.units) return null;
  const md = parseMd(texts.md);
  const units = parseUnits(texts.units);
  const notes = texts.notes ? parseNotes(texts.notes) : null;
  const align = texts.align ? parseAlign(texts.align) : null;
  const verses = mdVerses(md);
  const hash = textHash(verses);
  return { texts, md, units, notes, align, verses, hash, list: cut(verses, units.verses),
    stale: { units: headerHash(units.header) !== hash, notes: !!notes && headerHash(notes.header) !== hash, align: !!align && headerHash(align.header) !== hash } };
}

const baseOf = (u) => u.key + u.seg;
const splitBase = (b) => { const m = /^(\d+-\d+)(\/\d+)?$/.exec(b); return m ? { key: m[1], seg: m[2] || "" } : null; };

// The editor's units ({ ref, bases, text }) of every verse: each unit with a token range gets the text from its first token to
// the next such unit's first token (the first unit from the verse's start); a `=` unit is one more clause of the unit before it.
export function cut(verses, unitRows) {
  const out = [];
  for (const { ref, text } of verses) {
    const list = unitRows.get(ref);
    if (!list || !list.length) { out.push({ ref, bases: [], text }); continue; }
    const s = text.normalize("NFC"), spans = tokenSpans(s);
    const ranged = list.filter((u) => u.ranges);
    // a unit begins after the last white space before its first token, so opening punctuation (>>, «, ...) goes with it
    const starts = ranged.map((u, i) => (i === 0 ? 0 : cutOffset(s, spans, u.ranges[0][0])));
    let r = -1;
    for (const u of list) {
      if (!u.ranges) {
        if (out.length && out[out.length - 1].ref === ref) out[out.length - 1].bases.push(baseOf(u));
        else out.push({ ref, bases: [baseOf(u)], text: "" });
        continue;
      }
      r++;
      out.push({ ref, bases: [baseOf(u)], text: s.slice(starts[r], r + 1 < starts.length ? starts[r + 1] : s.length).trim() });
    }
  }
  return out;
}

// The .units row of one verse from its editor units: the first clause of a unit owns the unit's tokens, any further one is `=`;
// a clause met again in the verse is numbered `.2`, `.3` (a translator's split). Returns { row, error }.
export function unitsRow(ref, list) {
  const seen = new Map(), row = [];
  let at = 0;
  for (const u of list) {
    const n = tokenize(cleanText(u.text)).length;
    if (!n) return { error: `A clause of ${ref} has no words (digits and punctuation are not words): join it with a neighbour.` };
    u.bases.forEach((b, i) => {
      const k = splitBase(b);
      if (!k) throw new Error(`not a clause key: ${b}`);
      const c = (seen.get(b) || 0) + 1;
      seen.set(b, c);
      row.push({ ...k, part: c > 1 ? `.${c}` : "", ranges: i === 0 ? [[at, at + n - 1]] : null });
    });
    at += n;
  }
  return { row, n: at };
}

const sameUnits = (a, b) => JSON.stringify(a.map((u) => [u.bases, cleanText(u.text)])) === JSON.stringify(b.map((u) => [u.bases, cleanText(u.text)]));

// The chapter's files after an edit: `list` = the editor's units for the whole chapter. Verses whose text changed get their
// notes and links projected (profile `s`); every sidecar gets the new text hash. Returns { files: {ext: text}, error }.
export function buildChapter(ch, list) {
  const mine = byVerse(list), before = byVerse(ch.list);
  const known = new Set(ch.verses.map((v) => v.ref));
  const extra = [...mine.keys()].find((r) => !known.has(r));
  if (extra) return { error: `There is no verse ${extra} in this chapter.` };
  const md = { ...ch.md, lines: ch.md.lines.map((l) => ({ ...l })) };
  const unitRows = new Map(ch.units.verses);
  const notes = ch.notes && { header: ch.notes.header, notes: ch.notes.notes.map((n) => ({ ...n })) };
  const align = ch.align && { header: ch.align.header, rows: new Map(ch.align.rows) };
  let recut = false;
  for (const line of md.lines) {
    if (line.kind !== "verse" || !mine.has(line.ref)) continue;
    const units = mine.get(line.ref), old = before.get(line.ref) || [];
    if (sameUnits(units, old)) continue;
    const text = cleanText(units.map((u) => u.text).join(" ")).normalize("NFC");
    const r = unitsRow(line.ref, units);
    if (r.error) return { error: r.error };
    if (r.n !== tokenize(text).length) return { error: `The clauses of ${line.ref} do not add up to its text: check the spaces between them.` };
    if (JSON.stringify(units.map((u) => u.bases)) !== JSON.stringify(old.map((u) => u.bases))) recut = true;
    unitRows.set(line.ref, r.row);
    if (text !== line.text) {
      const p = projection(line.text, text);
      if (notes) for (const n of notes.notes) if (n.ref === line.ref) n.anchor = projectAnchor(p, n.anchor);
      const v = Number(line.ref.split(":")[1]);
      if (align && align.rows.has(v)) align.rows.set(v, projectRow(p, align.rows.get(v)));
      line.text = text;
    }
  }
  const hash = textHash(mdVerses(md));
  let uh = withHash(ch.units.header, hash);
  if (recut) uh = uh.map((l) => l.replace(/^# units: \w+/, "# units: edited"));
  const files = { md: serializeMd(md), units: serializeUnits({ header: uh, verses: unitRows }) };
  if (notes) files.notes = serializeNotes({ header: withHash(notes.header, hash), notes: notes.notes });
  if (align) files.align = serializeAlign({ header: withHash(align.header, hash), rows: align.rows });
  return { files };
}

// What the editor shows per verse besides the units: the alignment's profile letter, and whether the alignment is stale.
export function verseInfo(ch) {
  const info = {};
  for (const { ref } of ch.verses) {
    const row = ch.align?.rows.get(Number(ref.split(":")[1]));
    info[ref] = { profile: row ? row.profile : null, stale: !!ch.stale.align };
  }
  return info;
}

// Headings (and the title) by the verse they stand before; notes by verse.
export function display(ch) {
  const headings = {};
  let title = null, pending = [];
  for (const l of ch.md.lines) {
    if (l.kind === "title") title = l.text;
    else if (l.kind === "heading") pending.push(l.text);
    else if (l.kind === "verse") { if (pending.length) headings[l.ref] = pending; pending = []; }
  }
  const notes = {};
  for (const n of ch.notes?.notes || []) (notes[n.ref] ||= []).push({ kind: n.kind, anchor: n.anchor, text: n.text });
  return { title, headings, notes };
}

// ---- the three-way merge, verse by verse over all four files

function verseSig(ch, ref) {
  if (!ch) return "";
  const v = ch.verses.find((x) => x.ref === ref);
  const row = ch.align?.rows.get(Number(ref.split(":")[1]));
  return JSON.stringify([v ? v.text : null, ch.units.verses.get(ref) || null, row || null,
    (ch.notes?.notes || []).filter((n) => n.ref === ref)]);
}

const frame = (ch) => (ch ? JSON.stringify([ch.md.front, ch.md.lines.map((l) => (l.kind === "verse" ? ["v", l.ref] : [l.kind, l.text]))]) : "");

// base, ours, theirs: chapter models (base may be null). A verse changed on one side only takes that side; changed on both,
// differently, is a conflict { ref, base, ours, theirs } (unit lists) until `choices` ({ref: "ours" | "theirs"}) settles it.
// Returns { files, conflicts } with files built when there is no unsettled conflict.
export function mergeChapter(base, ours, theirs, choices = null) {
  const refs = [...new Set([...ours.verses, ...theirs.verses].map((v) => v.ref))].sort((a, b) => refKey(a) - refKey(b));
  const take = new Map(), conflicts = [];
  const B = byVerse(base ? base.list : []), O = byVerse(ours.list), T = byVerse(theirs.list);
  for (const r of refs) {
    const b = verseSig(base, r), o = verseSig(ours, r), t = verseSig(theirs, r);
    if (o === t || t === b) take.set(r, "ours");
    else if (o === b) take.set(r, "theirs");
    else {
      conflicts.push({ ref: r, base: B.get(r) || [], ours: O.get(r) || [], theirs: T.get(r) || [] });
      take.set(r, choices && choices[r] === "theirs" ? "theirs" : "ours");
    }
  }
  if (conflicts.length && !choices) return { conflicts };
  // the frame (front matter, title, headings) by the same rule, as a whole
  const shell = frame(theirs) !== frame(base) && frame(ours) === frame(base) ? theirs : ours;
  const pick = (r) => (take.get(r) === "theirs" ? theirs : ours);
  const textOf = (c, r) => c.verses.find((v) => v.ref === r)?.text;
  const md = { ...shell.md, lines: shell.md.lines.map((l) => (l.kind === "verse" ? { ...l, text: textOf(pick(l.ref), l.ref) ?? l.text } : l)) };
  const unitRows = new Map(refs.map((r) => [r, pick(r).units.verses.get(r)]).filter(([, l]) => l));
  const hash = textHash(mdVerses(md));
  const edited = [ours, theirs].some((c) => c.units.header.some((l) => l.startsWith("# units: edited")));
  let uh = withHash(ours.units.header, hash);
  if (edited) uh = uh.map((l) => l.replace(/^# units: \w+/, "# units: edited"));
  const files = { md: serializeMd(md), units: serializeUnits({ header: uh, verses: unitRows }) };
  if (ours.notes || theirs.notes) {
    const header = (ours.notes || theirs.notes).header;
    const all = refs.flatMap((r) => (pick(r).notes?.notes || []).filter((n) => n.ref === r));
    files.notes = serializeNotes({ header: withHash(header, hash), notes: all });
  }
  if (ours.align || theirs.align) {
    const header = (ours.align || theirs.align).header, rows = new Map();
    for (const r of refs) { const v = Number(r.split(":")[1]); const row = pick(r).align?.rows.get(v); if (row) rows.set(v, row); }
    files.align = serializeAlign({ header: withHash(header, hash), rows });
  }
  return { files, conflicts };
}

// ---- the chapter's status (FORMAT.md section 1: `status:` with fixed keys, values JSON strings; labels in `status_labels`)
export const STATUS_KEYS = ["maturity", "translation", "exegesis", "literary", "date"];

// { keys: [...], values: { key: "..." }, labels: [...] } from the front matter lines
export function readStatus(front) {
  const values = {}, keys = [];
  let inStatus = false, labels = [];
  for (const l of front || []) {
    if (/^status:\s*$/.test(l)) { inStatus = true; continue; }
    const m = inStatus && /^\s+([A-Za-z_]+):\s*(.*)$/.exec(l);
    if (m) { keys.push(m[1]); try { values[m[1]] = JSON.parse(m[2]); } catch { values[m[1]] = m[2]; } continue; }
    inStatus = false;
    const lab = /^status_labels:\s*(\[.*\])\s*$/.exec(l);
    if (lab) { try { labels = JSON.parse(lab[1]); } catch { /* as it is */ } }
  }
  return { keys, values, labels };
}

// The front matter with new status values (only keys it has, or the fixed ones), and the date of this version set to `today`
// in the form the file already uses (17.08.2026 or 2026-08-17). Returns the new lines.
export function setStatus(front, values, today = null) {
  const out = [...front];
  let start = out.findIndex((l) => /^status:\s*$/.test(l));
  if (start < 0) { out.push("status:"); start = out.length - 1; }
  let end = start + 1;
  while (end < out.length && /^\s+[A-Za-z_]+:/.test(out[end])) end++;
  const set = (k, v) => {
    const i = out.slice(start + 1, end).findIndex((l) => new RegExp(`^\\s+${k}:`).test(l));
    if (i >= 0) out[start + 1 + i] = `  ${k}: ${JSON.stringify(v)}`;
    else { out.splice(end, 0, `  ${k}: ${JSON.stringify(v)}`); end++; }
  };
  for (const [k, v] of Object.entries(values || {})) if (STATUS_KEYS.includes(k) && typeof v === "string") set(k, v.replace(/\s+/g, " ").trim());
  if (today) {
    const old = readStatus(out).values.date || "";
    const d = String(today.getUTCDate()).padStart(2, "0"), m = String(today.getUTCMonth() + 1).padStart(2, "0"), y = today.getUTCFullYear();
    set("date", /^\d{4}-\d{2}-\d{2}$/.test(old) ? `${y}-${m}-${d}` : `${d}.${m}.${y}`);
  }
  return out;
}
