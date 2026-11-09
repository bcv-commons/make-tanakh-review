// The checks of FORMAT.md section 6, run by .github/workflows/validate.yml on every pull request and every push to main and
// approved. Validation only: it reads the repository and never writes a file.
//
//   node .github/check/validate.mjs <repo root> [--keys keys.json] [--changed changed.txt]
//
// --keys: the clause keys of the pinned layout per verse (layout_keys.py); without it the keys are not checked (said once).
// --changed: the files a pull request changes (one per line); files other than chapter files are named in a notice.
// Alternative drafts (`.tanakh/alternatives/<kind>/<BOOK>/<BOOK>_<CCC>.*`, FORMAT.md section 9) are chapters too and get every
// chapter check, plus their own front matter keys.
// format.js and vendor/tokenize.js are copies of make-tanakh-review's src/lib/format.js and src/lib/vendor/tokenize.js (its
// tests keep them identical); the tokeniser is the published reference of bcv-commons/compact-alignments.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseMd, mdVerses, parseUnits, unitId, parseNotes, headerHash, hashInput, tokenize, cleanText, refKey, PROFILES, ALIGN_ITEM,
} from "./format.js";

const CHAPTER = /^([A-Z0-9]{3})\/\1_(\d{3})\.(md|units|notes|align)$/;
const ALT = /^\.tanakh\/alternatives\/([a-z0-9-]+)\/([A-Z0-9]{3})\/\2_(\d{3})\.(md|units|notes|align)$/;
const ALT_DIR = ".tanakh/alternatives/", ALT_README = `${ALT_DIR}README.md`;
const BOOK_DIR = /^[A-Z0-9]{3}\//;
const SIDECARS = ["units", "notes", "align"];
const NOTE_KINDS = new Set(["T", "E", "H", "N"]);
const UNITS_HEADER = /^# units: (authored|aligned|edited|migrated)\b/;
// the files a language repository holds besides its chapters (the template's)
const OTHER = [/^(README\.md|LICENSE|FORMAT\.md|CONTRIBUTING\.md|CODEOWNERS|roles\.json|\.gitignore|\.gitattributes)$/, /^\.github\//, /^\.tanakh\//];
const SECRETS = [
  [/-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/, "a private key"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/, "a GitHub token"],
  [/\bgithub_pat_[A-Za-z0-9_]{60,}/, "a GitHub token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS access key"],
  [/\bhf_[A-Za-z0-9]{34,}\b/, "a Hugging Face token"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, "a Slack token"],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, "an Anthropic key"],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}/, "an API key"],
];

const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const lineOf = (text, prefix) => { const i = text.split("\n").findIndex((l) => l.startsWith(prefix)); return i < 0 ? undefined : i + 1; };

// files: Map(path -> text). keys: { BOOK: { "c:v": ["first-last", "first-last/2", ...] } } or null. changed: [path] or null.
// Returns { errors: [{ file, line, msg }], notices: [{ file, msg }], chapters }.
export function validate(files, { keys = null, changed = null } = {}) {
  const errors = [], notices = [];
  const err = (file, msg, line) => errors.push({ file, line, msg });
  const chapters = new Map();

  for (const [file, text] of files) {
    for (const [re, what] of SECRETS) if (re.test(text)) err(file, `looks like ${what}: never commit secrets`, lineOf(text, text.split("\n").find((l) => re.test(l))));
    const a = ALT.exec(file);
    if (a) { const base = file.replace(/\.\w+$/, ""); if (!chapters.has(base)) chapters.set(base, { book: a[2], ch: Number(a[3]), alt: a[1] }); chapters.get(base)[a[4]] = text; continue; }
    if (file.startsWith(ALT_DIR)) { if (file !== ALT_README) err(file, "not a file of the alternative drafts: .tanakh/alternatives/ holds README.md and <kind>/<BOOK>/<BOOK>_<CCC>.md, .units, .notes, .align (FORMAT.md section 9)"); continue; }
    const m = CHAPTER.exec(file);
    if (m) { const base = file.replace(/\.\w+$/, ""); if (!chapters.has(base)) chapters.set(base, { book: m[1], ch: Number(m[2]) }); chapters.get(base)[m[3]] = text; continue; }
    if (BOOK_DIR.test(file) && !file.startsWith(".")) err(file, "not a chapter file: a book folder holds <BOOK>_<CCC>.md, .units, .notes and .align only");
    else if (!OTHER.some((re) => re.test(file))) err(file, "not a file of a language repository (FORMAT.md section 6)");
  }

  if (!keys) notices.push({ file: "", msg: "clause keys not checked against the pinned layout (no --keys)" });
  const unchecked = new Set();
  for (const [base, c] of [...chapters].sort()) {
    const f = (ext) => `${base}.${ext}`;
    if (c.alt) {
      const missing = ["md", ...SIDECARS].filter((ext) => c[ext] === undefined);
      if (c.md !== undefined && missing.length) err(f(missing[0]), `an alternative draft has all four files: ${missing.map((x) => f(x)).join(", ")} missing`);
      if (!files.has(`${c.book}/${c.book}_${String(c.ch).padStart(3, "0")}.md`)) notices.push({ file: f("md"), msg: `an alternative of ${c.book} ${c.ch}, which the repository does not have` });
    }
    if (c.md === undefined) { for (const ext of SIDECARS) if (c[ext] !== undefined) err(f(ext), `a sidecar without its text file ${f("md")}`); continue; }
    const md = parseMd(c.md);
    for (const e of md.errors) { const n = /^line (\d+)/.exec(e); err(f("md"), e, n ? Number(n[1]) : undefined); }
    if (!md.front.includes(`book: ${c.book}`)) err(f("md"), `front matter: no line "book: ${c.book}"`, 2);
    if (!md.front.includes(`chapter: ${c.ch}`)) err(f("md"), `front matter: no line "chapter: ${c.ch}"`, 2);
    if (c.alt) {
      const kind = md.front.find((l) => /^alternative:/.test(l)), built = md.front.find((l) => /^built:/.test(l));
      if (!kind || !new RegExp(`^alternative:\\s*"${c.alt}"\\s*$`).test(kind)) err(f("md"), `front matter: an alternative draft needs the line alternative: "${c.alt}" (its folder's kind)`, 2);
      if (!built || !/^built:\s*"\d{4}-\d{2}-\d{2}"\s*$/.test(built)) err(f("md"), `front matter: an alternative draft needs the line built: "YYYY-MM-DD"`, 2);
    }
    const verses = mdVerses(md), count = new Map();
    for (const v of verses) {
      const line = lineOf(c.md, `${v.ref}\t`);
      if (Number(v.ref.split(":")[0]) !== c.ch) err(f("md"), `verse ${v.ref} is not in chapter ${c.ch}`, line);
      if (v.text !== cleanText(v.text)) err(f("md"), `verse ${v.ref}: white space as the converter writes it (single spaces, none at the ends, no tab)`, line);
      count.set(v.ref, tokenize(v.text).length);
    }
    const hash = sha256(hashInput(verses));
    const verseIn = (ext, ref, line) => { if (count.has(ref)) return true; err(f(ext), `verse ${ref} is not in the text`, line); return false; };

    for (const ext of SIDECARS) {
      if (c[ext] === undefined) continue;
      const h = headerHash(c[ext].split("\n").filter((l) => l.startsWith("#")));
      if (!h) err(f(ext), "no `# text <sha256>` line in the header");
      else if (h !== hash) err(f(ext), `stale: its text hash does not match ${f("md")} (the text changed without this file)`, lineOf(c[ext], "# text "));
    }
    if (c.units === undefined && !c.alt) notices.push({ file: f("md"), msg: "no .units file: the editor cannot open this chapter" });

    if (c.units !== undefined) {
      const U = parseUnits(c.units);
      if (!UNITS_HEADER.test(c.units)) err(f("units"), "the first line must be `# units: authored | aligned | edited | migrated; ...`", 1);
      else if (c.alt && !/^# units: (authored|migrated)\b/.test(c.units)) err(f("units"), "an alternative draft is written in clause lines: `# units: authored; ...`", 1);
      for (const e of U.errors) err(f("units"), e, lineOf(c.units, `${e.split(":")[0]}\t`));
      const layout = keys ? keys[c.book] : null;
      if (keys && !layout) unchecked.add(c.book);
      for (const [ref, list] of U.verses) {
        const line = lineOf(c.units, `${ref}\t`);
        if (!verseIn("units", ref, line)) continue;
        const n = count.get(ref), owner = new Array(n).fill(0), ids = new Set();
        let at = -1;
        for (const u of list) {
          const id = unitId(u), k = u.key + u.seg;
          if (ids.has(id)) err(f("units"), `${ref}: ${id} twice`, line);
          ids.add(id);
          if (layout) {
            const i = (layout[ref] || []).indexOf(k);
            if (i < 0) err(f("units"), `${ref}: ${k} is not a clause of ${c.book} ${ref} in the pinned layout (.tanakh/layout.json)`, line);
            else if (i < at) err(f("units"), `${ref}: ${k} is out of Hebrew order`, line);
            else at = i;
          }
          for (const [a, b] of u.ranges || []) {
            if (a > b || b >= n) { err(f("units"), `${ref}: ${id}:${a}-${b} is outside the verse (${n} tokens)`, line); continue; }
            for (let t = a; t <= b; t++) owner[t]++;
          }
        }
        const twice = owner.findIndex((x) => x > 1);
        if (twice >= 0) err(f("units"), `${ref}: token ${twice} is in two units`, line);
      }
    }

    if (c.notes !== undefined) {
      const N = parseNotes(c.notes);
      for (const e of N.errors) err(f("notes"), e);
      for (const nt of N.notes) {
        const line = lineOf(c.notes, `${nt.ref}\t${nt.kind}\t${nt.anchor}\t`);
        if (!verseIn("notes", nt.ref, line)) continue;
        if (!NOTE_KINDS.has(nt.kind)) err(f("notes"), `${nt.ref}: note kind ${JSON.stringify(nt.kind)} is not T, E, H or N`, line);
        if (nt.anchor > count.get(nt.ref)) err(f("notes"), `${nt.ref}: anchor ${nt.anchor} is outside the verse (${count.get(nt.ref)} tokens)`, line);
        if (!nt.text.trim()) err(f("notes"), `${nt.ref}: an empty note`, line);
      }
    }

    if (c.align !== undefined) {
      const seen = new Set();
      c.align.split("\n").forEach((l, i) => {
        if (l === "" || l.startsWith("#")) return;
        const line = i + 1, cols = l.split("\t");
        if (cols.length !== 4 || !/^\d+$/.test(cols[0])) { err(f("align"), "a row is `verse<TAB>main links<TAB>function links<TAB>profile`", line); return; }
        const ref = `${c.ch}:${Number(cols[0])}`;
        if (seen.has(ref)) err(f("align"), `verse ${cols[0]} twice`, line);
        seen.add(ref);
        if (!verseIn("align", ref, line)) return;
        if (!(cols[3] in PROFILES)) err(f("align"), `verse ${cols[0]}: profile ${JSON.stringify(cols[3])} is not one of ${Object.keys(PROFILES).join(" ")}`, line);
        const n = count.get(ref);
        for (const it of `${cols[1]} ${cols[2]}`.split(" ").filter(Boolean)) {
          if (!ALIGN_ITEM.test(it)) { err(f("align"), `verse ${cols[0]}: cannot read ${it}`, line); continue; }
          const pos = it.startsWith("+") ? it.slice(1).split(",").map((x) => [Number(x.split(">")[0])])
            : /^\d+:/.test(it) ? it.split(":")[1].split(",").map((x) => x.split("-").map(Number)) : [];
          if (pos.some(([a, b = a]) => a > b || b >= n)) err(f("align"), `verse ${cols[0]}: ${it} names a token outside the verse (${n} tokens)`, line);
        }
      });
    }
  }
  const kinds = new Set([...chapters.values()].filter((c) => c.alt).map((c) => c.alt));
  if (kinds.size) {
    const readme = files.get(ALT_README);
    if (readme === undefined) err(ALT_README, `missing: one line per kind of alternative draft (${[...kinds].sort().join(", ")})`);
    else for (const k of [...kinds].sort()) if (!readme.split("\n").some((l) => l.trim().startsWith(`- \`${k}\``))) err(ALT_README, `no line "- \`${k}\` (...)" for the alternative drafts in .tanakh/alternatives/${k}/`);
  }
  for (const b of unchecked) notices.push({ file: b, msg: `${b}: not in the pinned Hebrew layout, its clause keys are not checked` });

  if (changed) {
    const alts = changed.filter((p) => p && p.startsWith(ALT_DIR));
    if (alts.length) notices.push({ file: "", msg: `this pull request changes the alternative drafts (${alts.length} files under ${ALT_DIR}): only the publisher writes them, they are never edited` });
    const other = changed.filter((p) => p && !CHAPTER.test(p) && !p.startsWith(ALT_DIR));
    if (other.length) notices.push({ file: "", msg: `this pull request changes files other than chapter files (${other.join(", ")}): it is merged on github.com, not in the editor` });
  }
  return { errors, notices, chapters: chapters.size };
}

// ---- the command line
function listFiles(root) {
  try {
    return execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean);
  } catch {
    const out = [], walk = (d) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
      const p = d ? `${d}/${e.name}` : e.name;
      if (e.name === ".git" || e.name === "node_modules") continue;
      if (e.isDirectory()) walk(p); else out.push(p);
    } };
    walk("");
    return out;
  }
}

function main(argv) {
  const root = argv[0] || ".";
  const opt = (name) => { const i = argv.indexOf(name); return i < 0 ? null : argv[i + 1]; };
  const files = new Map();
  for (const p of listFiles(root)) {
    const full = path.join(root, p);
    if (!fs.existsSync(full) || fs.statSync(full).size > 8 << 20) continue;
    files.set(p, fs.readFileSync(full, "utf8"));
  }
  const keys = opt("--keys") ? JSON.parse(fs.readFileSync(opt("--keys"), "utf8")) : null;
  const changed = opt("--changed") ? fs.readFileSync(opt("--changed"), "utf8").split("\n").filter(Boolean) : null;
  const { errors, notices, chapters } = validate(files, { keys, changed });
  const gh = !!process.env.GITHUB_ACTIONS, esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  for (const n of notices) console.log(gh ? `::notice${n.file ? ` file=${n.file}` : ""}::${esc(n.msg)}` : `notice: ${n.file ? `${n.file}: ` : ""}${n.msg}`);
  for (const e of errors) console.log(gh ? `::error file=${e.file}${e.line ? `,line=${e.line}` : ""}::${esc(e.msg)}` : `${e.file}${e.line ? `:${e.line}` : ""}: ${e.msg}`);
  const summary = `${chapters} chapters, ${files.size} files: ${errors.length ? `${errors.length} problems` : "all checks passed"}`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = errors.slice(0, 200).map((e) => `| \`${e.file}${e.line ? `:${e.line}` : ""}\` | ${e.msg.replace(/\|/g, "\\|")} |`);
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Chapter format (FORMAT.md section 6)\n\n${summary}\n\n`
      + (rows.length ? `| file | problem |\n|---|---|\n${rows.join("\n")}\n${errors.length > 200 ? `\n(${errors.length - 200} more)\n` : ""}` : "")
      + notices.map((n) => `- ${n.msg}\n`).join(""));
  }
  return errors.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
