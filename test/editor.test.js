// The browser script under jsdom: typing # and % re-renders the clause rows; the buttons do the same; save posts the chapter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM(`<div id="bar"></div><div id="editor"></div><div id="dialog"></div>`, { url: "http://localhost/" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage });
const posted = [];
globalThis.fetch = async (path, opts) => {
  posted.push({ path, body: JSON.parse(opts.body) });
  return { ok: true, status: 200, json: async () => ({ version: "v2", pr: { number: 7, status: "open" } }) };
};
const { start } = await import("../src/client/editor.js");

const units = [
  { ref: "1:1", bases: ["A"], text: "Efter at Moses var død," },
  { ref: "1:1", bases: ["B", "C"], text: "sagde HERREN til Josva:" },
  { ref: "1:2", bases: ["D"], text: "Min tjener er død." },
];
const hebrew = { 1: [{ key: "A", kind: "VC", rule: "V", words: [{ id: "a", surface: "וַיְהִי", gloss: "and.it.was", content: true, linked: false }] },
  { key: "B", kind: "VC", rule: "V", words: [] }, { key: "C", kind: "VC", rule: "V", words: [] }], 2: [{ key: "D", kind: "VC", rule: "V", words: [] }] };
start({ lang: "dan", file: "JOS/JOS_001.md", user: { login: "ann", agreed: true }, branch: "main", pr: null,
  units, version: "v1", main: units, approved: units, hebrew });

const boxes = () => [...document.querySelectorAll("textarea.u")];
const type = (i, value) => { const t = boxes()[i]; t.value = value; t.dispatchEvent(new window.Event("input")); };

test("renders a row per clause unit, Hebrew flags included", () => {
  assert.equal(boxes().length, 3);
  assert.equal(document.querySelectorAll(".verse").length, 2);
  assert.equal(document.querySelectorAll(".w.unlinked").length, 1);
});

test("# splits, % joins back, a cross-verse join is refused", () => {
  type(0, "Efter at Moses# var død,");
  assert.equal(boxes().length, 4);
  assert.equal(boxes()[1].value, "var død,");
  assert.equal(document.activeElement, boxes()[1]);
  assert.equal(document.querySelectorAll(".row.changed").length, 2);
  type(1, "%var død,");
  assert.equal(boxes().length, 3);
  assert.equal(boxes()[0].value, "Efter at Moses var død,");
  type(2, "%Min tjener er død.");
  assert.equal(boxes().length, 3);
  assert.match(document.querySelector("#bar .err").textContent, /within a verse/);
});

test("buttons split at the cursor and join", () => {
  const t = boxes()[1];
  t.setSelectionRange(5, 5);                                       // "sagde| HERREN til Josva:"
  t.closest(".row").querySelector('button[title^="Split"]').click();
  assert.deepEqual(boxes().map((b) => b.value).slice(1, 3), ["sagde", "HERREN til Josva:"]);
  boxes()[1].closest(".row").querySelector('button[title^="Join with the clause after"]').click();
  assert.equal(boxes()[1].value, "sagde HERREN til Josva:");
});

test("save posts the units and the loaded version", async () => {
  type(2, "Min tjener Moses er død.");
  document.querySelector("#bar button.primary").click();
  await new Promise((r) => setTimeout(r, 10));
  const p = posted.at(-1);
  assert.equal(p.path, "/api/save");
  assert.equal(p.body.version, "v1");
  assert.equal(p.body.units[2].text, "Min tjener Moses er død.");
  assert.match(document.querySelector("#bar").textContent, /proposal #7/);
});
