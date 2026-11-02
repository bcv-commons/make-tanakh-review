// The clause-unit model (PLAN.md sections 4.1 and 6), shared by the browser and the server.
//
// A unit: { ref: "1:3", bases: ["060010030011-060010030021", ...], text }. `bases` are the Hebrew clauses the unit renders, in
// order: the .units file's key (the span `first-last` of MACULA word ids) with the layout's own segment (`/2`) where there is one.
// The translator's part numbers of the file format (`A.2`) are derived: a clause rendered by more than one unit of its verse is
// written A, A.2, ... in reading order, so splitting and joining never renumber by hand. Reading and writing the chapter files is
// chapter.js (server) on format.js.

const SPLIT = "#";
const JOIN = "%";

export function refKey(ref) {
  const [c, v] = ref.split(":").map(Number);
  return c * 1000 + v;
}

// The label of each unit, verse by verse: its clauses as the Hebrew knows them (the first word id of the key's span, with the
// layout's segment `/2`), a clause met again in the verse numbered `.2`, `.3` as the .units file writes it; joined clauses with +.
export function atoms(units) {
  const seen = new Map();
  return units.map((u) =>
    u.bases.map((b) => {
      const k = `${u.ref}|${b}`, n = (seen.get(k) || 0) + 1;
      seen.set(k, n);
      return `${clauseKey(b)}${(b.match(/\/\d+$/) || [""])[0]}${n > 1 ? `.${n}` : ""}`;
    }).join("+"));
}

// the Hebrew clause key of a base ("060010010011-060010010061/2" -> "060010010011")
export const clauseKey = (b) => b.split(/[-/]/)[0];

// The edit box shows a literal # or % as \# or \%, so that the bare characters can act as commands.
export function toBox(text) {
  return text.replace(/\\/g, "\\\\").replace(/[#%]/g, (c) => "\\" + c);
}

export function fromBox(box) {
  return box.replace(/\\([\\#%])/g, "$1");
}

// position of the first unescaped `ch` in a box string, or -1
function findCommand(box, ch) {
  for (let i = 0; i < box.length; i++) {
    if (box[i] === "\\") { i++; continue; }
    if (box[i] === ch) return i;
  }
  return -1;
}

// Split unit i of a chapter at character `pos` of its text. A unit rendering several clauses gives the first part the clauses in
// proportion to where the cut falls (at least one each side); a unit of one clause gives it to both parts (A.1, A.2).
export function split(units, i, pos) {
  const u = units[i];
  const a = u.text.slice(0, pos).trim();
  const b = u.text.slice(pos).trim();
  if (!a || !b) return { units, error: "Nothing to split off here: put the cut between words." };
  let first = u.bases, second = u.bases;
  if (u.bases.length > 1) {
    const k = Math.min(u.bases.length - 1, Math.max(1, Math.round((pos / u.text.length) * u.bases.length)));
    first = u.bases.slice(0, k);
    second = u.bases.slice(k);
  }
  const out = [...units.slice(0, i), { ref: u.ref, bases: [...first], text: a }, { ref: u.ref, bases: [...second], text: b },
    ...units.slice(i + 1)];
  return { units: out, focus: i + 1 };
}

// Join unit i with unit i + 1 (same verse only).
export function join(units, i) {
  const u = units[i], w = units[i + 1];
  if (!u || !w) return { units, error: "There is no clause to join with." };
  if (u.ref !== w.ref) return { units, error: `Clauses are joined within a verse only (${u.ref} and ${w.ref}).` };
  const bases = [...u.bases];
  for (const b of w.bases) if (!bases.includes(b)) bases.push(b);
  const out = [...units.slice(0, i), { ref: u.ref, bases, text: `${u.text} ${w.text}`.trim() }, ...units.slice(i + 2)];
  return { units: out, focus: i };
}

// The edit box of unit i now reads `box`: apply its text, then a command it contains: # (split there), % first (join the unit
// before), % last (join the unit after). Returns { units, focus?, caret?, error? }.
export function applyBox(units, i, box) {
  const s = findCommand(box, SPLIT);
  if (s >= 0) {
    const before = fromBox(box.slice(0, s)), after = fromBox(box.slice(s + 1));
    const set = [...units.slice(0, i), { ...units[i], text: before + after }, ...units.slice(i + 1)];
    const r = split(set, i, before.length);
    return r.error ? { ...r, units: setText(units, i, before + after) } : r;
  }
  const trimmed = box.trim();
  if (trimmed.startsWith(JOIN)) {
    const set = setText(units, i, fromBox(trimmed.slice(1)));
    if (i === 0) return { units: set, error: "This is the first clause: there is nothing before it to join." };
    const r = join(set, i - 1);
    return r.error ? { ...r, units: set } : r;
  }
  if (trimmed.endsWith(JOIN) && !trimmed.endsWith("\\" + JOIN)) {
    const set = setText(units, i, fromBox(trimmed.slice(0, -1)));
    const r = join(set, i);
    return r.error ? { ...r, units: set } : r;
  }
  return { units: setText(units, i, fromBox(box)) };
}

function setText(units, i, text) {
  return units.map((u, j) => (j === i ? { ...u, text } : u));
}

// ---- comparing and merging, verse by verse

export function byVerse(units) {
  const m = new Map();
  for (const u of units) {
    if (!m.has(u.ref)) m.set(u.ref, []);
    m.get(u.ref).push(u);
  }
  return m;
}

const sig = (list) => JSON.stringify((list || []).map((u) => [u.bases, u.text.trim()]));

// refs whose units differ between a and b
export function changedVerses(a, b) {
  const A = byVerse(a), B = byVerse(b);
  return [...new Set([...A.keys(), ...B.keys()])].filter((r) => sig(A.get(r)) !== sig(B.get(r)))
    .sort((x, y) => refKey(x) - refKey(y));
}
