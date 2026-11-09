// The fallback glosses from bcv-commons/lexeme-alignments (config.lexemeGlosses): fetched at the pinned revision, kept on disk
// and in memory, a missing language remembered, a network failure not.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const data = fs.mkdtempSync(path.join(os.tmpdir(), "mtr-lg-"));
process.env.MTR_DATA = data;                      // before config is loaded: its cache goes here, not to .local
const C = await import("../src/lib/config.js");

test("lexemeGlosses: the pinned file, cached; 404 remembered; a failure retried", async () => {
  const calls = [];
  const top = { format: "lexeme-glosses/1", language: "dan", sources: ["dan_det"], function: [], lexemes: { "hbo:0430": [["gud", 1705]] } };
  let down = true;
  C.useFetch(async (url) => {
    calls.push(url);
    if (url.includes("iso=xyz")) return new Response("no", { status: 404 });
    if (down) throw new Error("offline");
    return new Response(JSON.stringify(top), { status: 200 });
  });
  assert.equal(await C.lexemeGlosses("dan"), null);                                       // offline
  down = false;
  assert.equal(await C.lexemeGlosses("dan"), null);                                       // not retried at once
  assert.equal(calls.length, 1);
  assert.equal(await C.lexemeGlosses("xyz"), null);
  assert.equal(await C.lexemeGlosses("xyz"), null);
  assert.equal(calls.filter((u) => u.includes("xyz")).length, 1);                         // 404 remembered
  assert.match(calls[0], new RegExp(`/datasets/bcv-commons/lexeme-alignments/resolve/${C.LEXEME_GLOSSES.revision}/iso=dan/top\\.json$`));
  assert.equal(await C.lexemeGlosses("../x"), null);
  const kept = path.join(data, "lexeme-glosses", C.LEXEME_GLOSSES.revision, "eng.json");
  fs.mkdirSync(path.dirname(kept), { recursive: true });
  fs.writeFileSync(kept, JSON.stringify({ ...top, language: "eng" }));
  assert.equal((await C.lexemeGlosses("eng")).language, "eng");                            // from the disk, no fetch
  assert.ok(!calls.some((u) => u.includes("iso=eng")));
});
