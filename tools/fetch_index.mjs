// Fetch compact-alignments' source index (for working without the network: the editor fetches it itself) (the per-verse lists of MACULA keys that the .align ordinals count, and the lexemes
// of the same lists) for the poetry view (src/lib/poetry.js) and the glosses (src/lib/renderings.js) into $MTR_DATA/index (default .local/index), each file checked against the published _source.json.
// Read-only side data, CC BY 4.0 (MACULA); never committed.
//   node tools/fetch_index.mjs GEN JOS ...        (no books: every Hebrew book)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BOOK_ORDER, COMPACT_INDEX } from "../src/lib/config.js";

const BASE = `https://huggingface.co/datasets/${COMPACT_INDEX.dataset}/resolve/${COMPACT_INDEX.revision}/_index`;   // the revision the editor pins
const DIR = path.join(process.env.MTR_DATA || path.resolve(".local"), "index");
const books = process.argv.slice(2).length ? process.argv.slice(2) : BOOK_ORDER;

async function get(url) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "make-tanakh-review" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i === 3) throw new Error(`${url}: ${e.message}`);
      await new Promise((ok) => setTimeout(ok, 2000 * (i + 1)));
    }
  }
}

fs.mkdirSync(DIR, { recursive: true });
const source = JSON.parse(await get(`${BASE}/_source.json`));
fs.writeFileSync(path.join(DIR, "_source.json"), JSON.stringify(source));
for (const b of books) {
  const want = source.books?.[b];
  if (!want) { console.log(`${b}: not in the index`); continue; }
  // the lexeme lists' checksums: `sha256` (content, _lexemes.json) and `fn_sha256` (function words, _fn.json)
  for (const [kind, shaKey] of [["keys", "keys_sha256"], ["fn_keys", "fn_keys_sha256"], ["lexemes", "sha256"], ["fn", "fn_sha256"]]) {
    const file = path.join(DIR, `${b}_${kind}.json`), sha = want[shaKey];
    const has = fs.existsSync(file) && crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") === sha;
    if (has) continue;
    const data = await get(`${BASE}/${b}_${kind}.json`);
    if (crypto.createHash("sha256").update(data).digest("hex") !== sha) throw new Error(`${b}_${kind}.json: not the published file`);
    fs.writeFileSync(file, data);
  }
  console.log(`${b}: ok`);
}
