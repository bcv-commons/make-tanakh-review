// The editor in the browser (PLAN.md section 6): renders verse by verse, applies # and % as they are typed, saves the chapter.
import { applyBox, split, join, toBox, fromBox, byVerse, atoms, clauseKey } from "../lib/units.js";
import { poemLines } from "../lib/poetry.js";
import { forUnit, agreement, shade } from "../lib/alternatives.js";

// The status of a verse's alignment, from its .align profile letter (template/FORMAT.md section 2)
const PROFILE = { a: ["aligned by script", ""], b: ["aligned by an agent", ""], h: ["links checked by a person", "ok"],
  j: ["links judged by Jev", "ok"], s: ["links re-projected after an edit: check", "check"] };

let S;            // state: the page data + units, dirty, gloss mode
const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

const canEdit = () => S.user && S.user.agreed;
const sig = (u) => JSON.stringify([u.bases, u.text.trim()]);

export function start(data) {
  const g = localGet("mtr-glosses", "da");
  const a = localGet("mtr-alts", "all");
  S = { ...data, glossTable: data.glosses, dirty: false, glosses: g === "en" || g === "0" ? g : "da", msg: "", err: false,
    alts: ["all", "shade", "off"].includes(a) ? a : "all", undo: null, uses: [], statusEdits: {} };
  S.mainSigs = new Map([...byVerse(S.main)].map(([r, l]) => [r, new Set(l.map(sig))]));
  S.mainVerse = new Map([...byVerse(S.main)].map(([r, l]) => [r, JSON.stringify(l.map(sig))]));
  S.savedText = verseTexts(S.units);
  S.loadedText = { ...S.savedText };   // the text the poetry lines were placed on
  render();
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); }
  });
  window.addEventListener("beforeunload", (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });
}

const verseTexts = (units) => Object.fromEntries([...byVerse(units)].map(([r, l]) => [r, l.map((x) => x.text.trim()).join(" ")]));

function localGet(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: fine */ } }

function say(msg, err = false) { S.msg = msg; S.err = err; renderBar(); }

function renderBar() {
  const bar = $("#bar");
  bar.replaceChildren();
  let status;
  if (!S.user) status = "Reading the working text. Sign in (top right) to edit.";
  else if (!S.user.agreed) status = "Sign in again and tick “my edits are CC0” to edit.";
  else if (S.pr) status = `Your proposal #${S.pr.number}${S.pr.status === "conflict" ? " — the working text changed the same verses: bring it in and choose" : ""}`;
  else status = "Working text. Your first save makes a proposal for review.";
  bar.append(el("span", { class: "status" }, status));
  if (canEdit()) {
    bar.append(el("button", { class: "primary", onclick: save, disabled: !S.dirty }, S.dirty ? "Save (Ctrl+S)" : "Saved"));
    if (S.pr) bar.append(el("button", { onclick: bringInMain, title: "Merge the working text's newer changes into your proposal" }, "Bring in the working text"));
  }
  const opt = (v, label) => el("option", { value: v, selected: S.glosses === v }, label);
  bar.append(el("label", { class: "toggle", title: "What stands under each Hebrew word" }, "glosses ",
    el("select", { onchange: (e) => { S.glosses = e.target.value; localSet("mtr-glosses", S.glosses); render(); } },
      opt("da", S.langName || "the translation"), opt("en", "English (MACULA)"), opt("0", "none"))));
  if ((S.alternatives || []).length) {
    const o = (v, label) => el("option", { value: v, selected: S.alts === v }, label);
    bar.append(el("label", { class: "toggle", title: `The other drafts of this chapter (${S.alternatives.map((x) => x.kind).join(", ")}), read only: `
      + "under each clause, and the main text's words shaded where they have them not (strong: none has the word; light: some have it)" },
      "other drafts ", el("select", { onchange: (e) => { S.alts = e.target.value; localSet("mtr-alts", S.alts); render(); } },
        o("all", "shown, with shading"), o("shade", "shading only"), o("off", "off"))));
  }
  if (S.undo) bar.append(el("button", { onclick: undoUse, title: "Put back the clause's text from before" }, `Undo “use ${S.undo.kind}”`));
  if (S.msg) bar.append(el("span", { class: S.err ? "err" : "note" }, S.msg));
}

// Under a Hebrew word: in the translation, the draft's own rendering (its .align links, as the page loaded it) or, where it has
// none or the verse was changed since, the word's commonest renderings (the repo's glosses file, else lexeme-alignments) in italics; or MACULA's English.
function wordGloss(w, live) {
  const r = live && (S.renderings || {})[w.id], usual = (S.glossTable || {})[w.id];
  const tip = [r && `this draft: ${r}`, usual && `usually${S.glossSource ? ` (${S.glossSource})` : ""}: ${usual.map(([f, c]) => `${f} ${c}`).join(" · ")}`].filter(Boolean).join("\n");
  if (S.glosses === "en") return { text: w.gloss, tip: w.gloss, cls: "g" };
  if (S.glosses === "0") return { text: null, tip: tip || null, cls: "g" };
  return r ? { text: r, tip, cls: "g" } : { text: usual ? usual[0][0] : null, tip: tip || null, cls: "g c" };
}

// The Hebrew of a clause piece: `key` the first piece, `key/n` the n-th piece of that clause, counted over the chapter's verses
// in order (a piece may stand in a later verse than the clause's first)
function piece(verse, b) {
  const key = clauseKey(b), n = Number((/\/(\d+)$/.exec(b) || [0, 1])[1]);
  const vs = Object.keys(S.hebrew || {}).map(Number).sort((x, y) => x - y).filter((v) => v <= Number(verse));
  const all = vs.flatMap((v) => (S.hebrew[v] || []).filter((x) => x.key === key).map((x) => ({ v, x })));
  const hit = all[n - 1];
  return hit && hit.v === Number(verse) ? hit.x : (n === 1 ? (S.hebrew[verse] || []).find((x) => x.key === key) : null);
}

function hebrewCell(verse, u, seen) {
  const clauses = S.hebrew[verse] || [];
  // the loaded alignment still fits the verse: its links say which content words are rendered
  const live = verseTexts(S.units.filter((x) => x.ref === u.ref))[u.ref] === S.loadedText[u.ref];
  const info = (S.verses || {})[u.ref] || {}, known = live && !info.stale && !!info.profile && Object.keys(S.renderings || {}).length > 0;
  const cell = el("div", { class: "heb", dir: "rtl", lang: "he" });
  for (const b of u.bases) {
    const key = clauseKey(b), c = piece(verse, b);
    if (!c) { cell.append(el("div", { class: "muted", dir: "ltr" }, `(clause ${key})`)); continue; }
    if (seen.has(b)) { cell.append(el("div", { class: "cont", dir: "ltr" }, "… the same Hebrew clause, continued")); continue; }
    seen.add(b);
    // a later piece of a clause another clause interrupts (`/2`, `/3`: FORMAT.md section 3): its own words, and which clause it continues
    const first = /\/\d+$/.test(b) ? Object.keys(S.hebrew || {}).map(Number).sort((x, y) => x - y)
      .flatMap((v) => S.hebrew[v] || []).find((x) => x.key === key) : null;
    if (first) cell.append(el("div", { class: "cont", dir: "ltr", title: "The clause is interrupted by another one; this is its next piece" },
      `… continues the clause “${first.words.slice(0, 3).map((w) => w.surface).join(" ")}”`));
    cell.append(el("div", { class: "clause", title: `${c.kind} ${c.rule}` },
      c.words.map((w) => {
        const g = wordGloss(w, live), unlinked = w.content && (known ? !(S.renderings || {})[w.id] : !w.linked);
        return el("span", { class: `w${unlinked ? " unlinked" : ""}`, title: g.tip, "data-w": w.id },
          el("span", { class: "s" }, w.surface), g.text ? el("span", { class: g.cls, dir: "ltr" }, g.text) : null);
      })));
  }
  return cell;
}

// The verse number with the alignment's status: re-projected or stale links say "check"; a verse changed here says its links
// will be re-projected when it is saved.
function verseHead(ref, changedHere) {
  const v = ref.split(":")[1], info = (S.verses || {})[ref] || {};
  const [label, cls] = info.stale ? ["the alignment does not match the text: check", "check"] : PROFILE[info.profile] || [null, ""];
  const tag = changedHere ? el("div", { class: "vstat", title: "The links of this verse are re-projected onto the new text when you save" }, "links re-projected on save")
    : label ? el("div", { class: `vstat${cls ? ` ${cls}` : ""}`, title: label }, cls === "check" ? "check links" : cls === "ok" ? "links checked" : "") : null;
  return el("div", { class: "vnum" }, v, tag && tag.textContent ? tag : null);
}

function notesOf(ref) {
  const list = (S.notes || {})[ref];
  if (!list || !list.length) return null;
  const KIND = { T: "text", E: "exegesis", H: "cross-reference", N: "note" };
  return el("ul", { class: "notes" }, list.map((n) => el("li", { title: `after word ${n.anchor}` },
    el("span", { class: "nkind" }, KIND[n.kind] || n.kind), " ", n.text)));
}

// A verse in poetry lines (FORMAT.md section 5), as the page loaded it; a verse whose text changed since is not shown so
// (its lines are placed again from the new alignment when the page is opened again).
function poemOf(ref, text) {
  const br = (S.poetry || {})[ref];
  if (!br || !br.length || text !== S.loadedText[ref]) return null;
  return el("div", { class: "poem", title: "The verse in the Hebrew's poetry lines" },
    poemLines(text, br).map((l) => el("div", { class: `pl l${Math.min(l.level, 3)}` }, l.text)));
}

function render(focus = null, caret = null) {
  renderBar();
  const root = $("#editor");
  root.replaceChildren();
  const labels = atoms(S.units);
  root.append(statusBlock());
  if (S.title) root.append(el("h2", { class: "ctitle" }, S.title));
  let verse = null, block = null, seen = null;
  const blocks = [];
  S.units.forEach((u, i) => {
    if (u.ref !== verse) {
      verse = u.ref; seen = new Set();
      const v = verse.split(":")[1];
      const mine = S.units.filter((x) => x.ref === verse);
      const textChanged = mine.map((x) => x.text.trim()).join(" ") !== (S.savedText || {})[verse];
      for (const h of (S.headings || {})[verse] || []) root.append(el("h3", { class: "heading" }, h));
      block = el("section", { class: `verse${S.mainVerse.get(verse) !== JSON.stringify(mine.map(sig)) ? " changed" : ""}`, id: `v${v}` },
        verseHead(verse, textChanged));
      root.append(block);
      blocks.push([verse, block]);
    }
    const changed = !(S.mainSigs.get(u.ref) || new Set()).has(sig(u));
    const ta = el("textarea", { class: "u", rows: 1, readonly: !canEdit(), "data-i": i, spellcheck: "true", lang: S.langTag || S.lang });
    ta.value = toBox(u.text);
    ta.addEventListener("input", () => onInput(i, ta));
    const tools = canEdit() ? el("div", { class: "tools" },
      el("button", { title: "Split at the cursor (#)", onclick: () => {
        const r = split(S.units, i, fromBox(ta.value.slice(0, ta.selectionStart)).length); apply(r, r.focus, 0);
      } }, "✂"),
      el("button", { title: "Join with the clause before (% first)", disabled: i === 0, onclick: () => {
        const at = S.units[i - 1]?.text.length + 1; const r = join(S.units, i - 1); apply(r, r.focus, at);
      } }, "⤒"),
      el("button", { title: "Join with the clause after (% last)", disabled: i === S.units.length - 1, onclick: () => {
        const at = u.text.length + 1; const r = join(S.units, i); apply(r, r.focus, at);
      } }, "⤓")) : null;
    const heb = hebrewCell(verse.split(":")[1], u, seen);
    block.append(el("div", { class: `row${changed ? " changed" : ""}` }, heb,
      el("div", { class: "tgt" }, el("span", { class: "lab", title: "Hebrew clause(s) this unit renders" }, labels[i]),
        el("div", { class: "boxwrap" }, paint(el("div", { class: "mirror", "data-i": i, "aria-hidden": "true" }), u), ta), tools,
        S.alts === "all" ? altsOf(i, u) : null)));
  });
  const texts = verseTexts(S.units);
  for (const [ref, b] of blocks) { const p = poemOf(ref, texts[ref]); if (p) b.append(p); const n = notesOf(ref); if (n) b.append(n); }
  root.querySelectorAll("textarea.u").forEach(autosize);
  if (focus != null) {
    const t = root.querySelector(`textarea[data-i="${focus}"]`);
    if (t) { t.focus(); const p = caret == null ? t.value.length : toBox(S.units[focus].text.slice(0, caret)).length; t.setSelectionRange(p, p); }
  }
}

// The main text's words the other drafts do not have (FORMAT.md section 9), shaded in the mirror behind the box: computed from
// the current text on every change. Strong: no other draft has the word in this clause; light: some have it.
function paint(m, u) {
  m.replaceChildren();
  if (S.alts === "off" || !(S.alternatives || []).length) return m;
  const s = u.text, nfc = s.normalize("NFC");
  if (nfc !== s) return m;                       // offsets would not match the box
  const ag = agreement(S.alternatives, u);
  if (!ag.available) return m;
  let at = 0;
  for (const t of ag.tokens) {
    const sh = shade(ag.available, t.support);
    if (sh === "none") continue;
    m.append(toBox(s.slice(at, t.start)), el("mark", { class: `alt-${sh}` }, toBox(s.slice(t.start, t.end))));
    at = t.end;
  }
  m.append(toBox(s.slice(at)));
  return m;
}

// Under a clause: what each other draft has for the same Hebrew clause(s), read only, with a button that puts it in the box
function altsOf(i, u) {
  const list = forUnit(S.alternatives, u);
  if (!list.length) return null;
  return el("div", { class: "alts" }, list.map((a) => {
    const text = a.units.map((x) => x.text).join(" ");
    return el("div", { class: "alt" }, el("span", { class: "akind", title: a.about }, a.kind),
      text ? el("span", { class: "atext" }, text) : el("span", { class: "atext none", title: "This draft has no words for this clause (its notes may say why)" }, "—"),
      text && canEdit() ? el("button", { class: "use", title: `Put ${a.kind}'s words in this clause's box (an ordinary edit: save to keep it)`,
        onclick: () => useAlt(i, a.kind, text) }, "use") : null);
  }));
}

// The chapter's status (FORMAT.md section 1), its labels in the language: edited like the text, in the proposal; the date of the
// version is set by the save. Who made the drafts (.tanakh/publisher.json) below it.
const STATUS_KEYS = ["maturity", "translation", "exegesis", "literary", "date"];
function statusBlock() {
  const st = S.status || { keys: [], values: {}, labels: [] };
  const keys = [...new Set([...STATUS_KEYS, ...st.keys])];
  const val = (k) => (k in S.statusEdits ? S.statusEdits[k] : st.values[k] ?? "");
  const label = (k) => st.labels[STATUS_KEYS.indexOf(k)] || k;
  const pub = S.publisher && (S.publisher.name || S.publisher.login);
  const box = el("details", { class: "status" }, el("summary", {}, [val("maturity"), val("date")].filter(Boolean).join(" · ") || "Status",
    Object.keys(S.statusEdits).length ? el("span", { class: "note" }, " (changed)") : null),
    el("div", { class: "sgrid" }, keys.map((k) => [el("label", { for: `st-${k}` }, label(k)),
      k === "date" ? el("span", { id: `st-${k}`, class: "muted", title: "Set to the day of the save" }, `${val(k) || "—"} (set when you save)`)
        : el("input", { id: `st-${k}`, value: val(k), readonly: !canEdit(), oninput: (e) => {
          S.statusEdits[k] = e.target.value; if (!S.dirty) { S.dirty = true; renderBar(); }
        } })])),
    pub ? el("div", { class: "muted pub" }, "Drafts made by ", S.publisher.url ? el("a", { href: S.publisher.url, rel: "noopener" }, pub) : pub) : null);
  if (Object.keys(S.statusEdits).length) box.open = true;
  return box;
}

const today = (old) => {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return /^\d{4}-/.test(old || "") ? `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` : `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
};

function useAlt(i, kind, text) {
  const old = S.units[i].text;
  S.uses.push({ ref: S.units[i].ref, bases: S.units[i].bases, kind });
  S.units = S.units.map((x, k) => (k === i ? { ...x, text } : x));
  S.dirty = true; S.undo = { i, text: old, kind, ref: S.units[i].ref };
  S.msg = "";
  render(i);
}

function undoUse() {
  const u = S.undo;
  if (!u || !S.units[u.i] || S.units[u.i].ref !== u.ref) { S.undo = null; renderBar(); return; }
  S.units = S.units.map((x, k) => (k === u.i ? { ...x, text: u.text } : x));
  S.uses.pop();
  S.undo = null;
  render(u.i);
}

function autosize(t) { t.style.height = "auto"; t.style.height = `${t.scrollHeight + 2}px`; }

function apply(r, focus, caret) {
  S.undo = null;
  if (r.error) { S.units = r.units; say(r.error, true); render(focus, caret); return; }
  S.units = r.units; S.dirty = true; S.msg = "";
  render(focus, caret);
}

function onInput(i, ta) {
  const before = S.units.length;
  const r = applyBox(S.units, i, ta.value);
  if (r.error) { S.units = r.units; S.dirty = true; say(r.error, true); render(i); return; }
  if (r.units.length !== before) {
    const caret = r.units.length > before ? 0 : (r.focus === i - 1 ? S.units[i - 1].text.length + 1 : S.units[i].text.length + 1);
    apply(r, r.focus, caret);
    return;
  }
  S.units = r.units;
  if (S.undo || !S.dirty) { S.undo = null; S.dirty = true; renderBar(); }
  autosize(ta);
  const m = ta.parentNode.querySelector(".mirror");
  if (m) paint(m, S.units[i]);
  const row = ta.closest(".row");
  row.classList.toggle("changed", !(S.mainSigs.get(S.units[i].ref) || new Set()).has(sig(S.units[i])));
}

async function post(path, payload) {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  let j = {};
  try { j = await r.json(); } catch { /* empty */ }
  return { ok: r.ok, status: r.status, ...j };
}

async function save() {
  if (!canEdit() || !S.dirty) return;
  const empty = S.units.findIndex((u) => !u.text.trim());
  if (empty >= 0) { say(`Clause ${S.units[empty].ref} is empty: write something or join it with a neighbour.`, true); return; }
  say("Saving…");
  const r = await post("/api/save", { lang: S.lang, file: S.file, units: S.units, version: S.version, status: S.statusEdits, uses: S.uses });
  if (!r.ok) { say(r.error || `Not saved (${r.status}).`, true); return; }
  S.version = r.version; S.dirty = false; S.undo = null; S.uses = [];
  if (!r.unchanged && S.status) S.status = { ...S.status, values: { ...S.status.values, ...S.statusEdits, date: today(S.status.values.date) } };
  S.statusEdits = {};
  for (const ref of Object.keys(S.verses || {})) if (verseTexts(S.units)[ref] !== S.savedText[ref]) S.verses[ref] = { ...S.verses[ref], profile: "s", stale: false };
  S.savedText = verseTexts(S.units);
  render();
  if (r.pr) S.pr = r.pr;
  say(r.unchanged ? "Nothing changed." : `Saved to your proposal #${S.pr.number}.`);
}

async function bringInMain() {
  if (S.dirty) { say("Save first, then bring in the working text.", true); return; }
  const r = await post("/api/update-branch", { lang: S.lang });
  if (!r.ok) { say(r.error || "Failed.", true); return; }
  if (!r.conflicts?.length) { location.reload(); return; }
  const choices = {};
  const show = (list) => el("ol", {}, list.map((u) => el("li", {}, u.text)));
  const dlg = el("div", { class: "modal" }, el("div", { class: "box" },
    el("h2", {}, "Choose per verse"),
    el("p", {}, "The working text and your proposal both changed these verses. Pick the version to keep; you can edit it afterwards."),
    r.conflicts.map((c) => {
      (choices[c.file] ||= {})[c.ref] = "ours";
      const name = `c-${c.file}-${c.ref}`;
      return el("fieldset", {}, el("legend", {}, `${c.file.split("/")[0]} ${c.ref}`),
        el("label", {}, el("input", { type: "radio", name, checked: true, onchange: () => { choices[c.file][c.ref] = "ours"; } }), " Yours", show(c.ours)),
        el("label", {}, el("input", { type: "radio", name, onchange: () => { choices[c.file][c.ref] = "theirs"; } }), " The working text", show(c.theirs)));
    }),
    el("div", { class: "actions" },
      el("button", { onclick: () => dlg.remove() }, "Cancel"),
      el("button", { class: "primary", onclick: async () => {
        const x = await post("/api/update-branch", { lang: S.lang, choices });
        if (!x.ok) { say(x.error || "Failed.", true); dlg.remove(); return; }
        location.reload();
      } }, "Apply"))));
  $("#dialog").append(dlg);
}
