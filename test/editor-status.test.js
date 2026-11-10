// The editor's view of the chapter format: the alignment status per verse from the .align profile letters, the title, headings
// and notes; a verse whose text is edited says its links are re-projected on save.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM(`<div id="bar"></div><div id="editor"></div><div id="dialog"></div>`, { url: "http://localhost/" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage });
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ version: {}, pr: { number: 3, status: "open" } }) });
const { start } = await import("../src/client/editor.js");

const A = "060010010011-060010010061", B = "060010010071-060010010141", C = "060010020011-060010020051", E = "060010030011-060010030021";
const units = [
  { ref: "1:1", bases: [A], text: "Efter at Moses var død," },
  { ref: "1:1", bases: [B], text: "sagde HERREN til Josva:" },
  { ref: "1:2", bases: [C], text: "Min tjener er død." },
  { ref: "1:3", bases: [E], text: "Hvert sted." },
];
const hebrew = { 1: [{ key: "060010010011", kind: "VC", rule: "V", words: [{ id: "a1", surface: "מוֹת", gloss: "death", content: true }] }] };
start({ lang: "dan", file: "JOS/JOS_001.md", book: "JOS", chapter: 1, user: { login: "ann", agreed: true }, branch: "main", pr: null,
  units, version: {}, main: units, approved: units, hebrew,
  verses: { "1:1": { profile: "b", stale: false }, "1:2": { profile: "s", stale: false }, "1:3": { profile: "h", stale: false } },
  title: "Josvabogen, kapitel 1", headings: { "1:1": ["Josva bliver leder"] }, notes: { "1:2": [{ kind: "T", anchor: 4, text: "Ordret: tjener." }] },
  poetry: { "1:1": [{ at: 0, level: 1 }, { at: 5, level: 2 }] } });

const boxes = () => [...document.querySelectorAll("textarea.u")];

test("title, heading before its verse, notes under their verse, Hebrew clause found by its key", () => {
  assert.equal(document.querySelector(".ctitle").textContent, "Josvabogen, kapitel 1");
  assert.equal(document.querySelector(".heading").nextElementSibling.id, "v1");
  assert.match(document.querySelector("#v2 .notes").textContent, /Ordret: tjener\./);
  assert.equal(document.querySelectorAll("#v1 .clause").length, 1);
  assert.match(document.querySelector("#v1").textContent, /clause 060010010071/);   // no Hebrew data for it: its key
  assert.deepEqual([...document.querySelectorAll("#v1 .poem .pl")].map((l) => [l.className, l.textContent]),
    [["pl l1", "Efter at Moses var død,"], ["pl l2", "sagde HERREN til Josva:"]]);
  assert.equal(document.querySelector("#v2 .poem"), null);
});

test("statuses from the profile letters: s = check, h = checked, b = nothing to say", () => {
  assert.match(document.querySelector("#v2 .vstat.check").textContent, /check links/);
  assert.match(document.querySelector("#v3 .vstat.ok").textContent, /links checked/);
  assert.equal(document.querySelector("#v1 .vstat"), null);
});

test("a verse whose text is edited: links re-projected on save, then shown as to check", async () => {
  const t = boxes()[0];
  t.value = "Efter at Moses døde,";
  t.dispatchEvent(new window.Event("input"));
  boxes()[1].dispatchEvent(new window.Event("input"));   // any re-render keeps the state
  document.querySelector("#bar button.primary").click();
  await new Promise((r) => setTimeout(r, 10));
  assert.match(document.querySelector("#v1 .vstat.check").textContent, /check links/);
  assert.match(document.querySelector("#bar").textContent, /proposal #3/);
  assert.equal(document.querySelector("#v1 .poem"), null);                  // placed on the old text: not shown
});
