// The Hebrew side (config.hebrew): bcv-commons/tanakh-hebrew-clauses at the pinned revision, the English glosses joined from
// MACULA Hebrew's own files at the pinned commit, both kept; without the network the local build in DATA/hebrew.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const data = fs.mkdtempSync(path.join(os.tmpdir(), "mtr-heb-"));
process.env.MTR_DATA = data;
const C = await import("../src/lib/config.js");

const CH = { book: "RUT", chapter: 1, verses: { 1: [{ key: "080010010011", kind: "VC", rule: "V-PP", words: [
  { id: "08001001001", surface: "וַיְהִ֗י", content: true }, { id: "08001001002", surface: "בִּימֵי֙", content: true }] }] } };
const XML = `<m><w xml:id="o080010010011"\n english="and" gloss="and" unicode="וַ">וַ</w><w role="v"><w gloss="it.was" xml:id="o080010010012">יְהִ֗י</w></w>
  <w xml:id="o080010010021" gloss="in">בִּ</w><w xml:id="o080010010022" gloss="">ה</w><w xml:id="o080010010023" gloss="the.days &amp; nights">ימֵי֙</w></m>`;

test("maculaFile: the lowfat file of a chapter", () => {
  assert.equal(C.maculaFile("RUT", 1), "WLC/lowfat/08-Rut-001-lowfat.xml");
  assert.equal(C.maculaFile("1SA", 12), "WLC/lowfat/09-1Sa-012-lowfat.xml");
  assert.equal(C.maculaFile("HOS", 3), "WLC/lowfat/28-HOS-003-lowfat.xml");
  assert.equal(C.maculaFile("MAT", 1), null);
});

test("hebrew: the pinned chapter with MACULA's glosses joined per word; kept; offline the local build", async () => {
  const calls = [];
  let down = false;
  C.useFetch(async (url) => {
    calls.push(url);
    if (down) throw new Error("offline");
    if (url.includes("huggingface.co")) return new Response(JSON.stringify(CH), { status: 200 });
    return new Response(XML, { status: 200 });
  });
  const h = await C.hebrew("RUT", 1);
  assert.deepEqual(h.verses[1][0].words.map((w) => w.gloss), ["and it.was", "in the.days & nights"]);   // empty ones skipped
  assert.match(calls.find((u) => u.includes("huggingface")), new RegExp(`/datasets/bcv-commons/tanakh-hebrew-clauses/resolve/${C.HEBREW.revision}/data/RUT/001\\.json$`));
  assert.equal(calls.find((u) => u.includes("githubusercontent")), `https://raw.githubusercontent.com/Clear-Bible/macula-hebrew/${C.MACULA_HEBREW.commit}/WLC/lowfat/08-Rut-001-lowfat.xml`);
  await C.hebrew("RUT", 1);
  assert.equal(calls.length, 2);                                                       // kept
  assert.ok(fs.existsSync(path.join(data, "tanakh-hebrew", C.HEBREW.revision, "RUT", "001.json")));
  down = true;
  assert.deepEqual((await C.hebrew("RUT", 2)).verses, {});                             // offline, no local build
  fs.mkdirSync(path.join(data, "hebrew", "RUT"), { recursive: true });
  fs.writeFileSync(path.join(data, "hebrew", "RUT", "003.json"), JSON.stringify({ ...CH, chapter: 3 }));
  assert.equal((await C.hebrew("RUT", 3)).chapter, 3);
  assert.deepEqual((await C.hebrew("../x", 1)).verses, {});
});
