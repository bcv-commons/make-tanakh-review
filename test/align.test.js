// Projection of links and anchors across a text edit (PLAN.md 16.2 step 1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenMap, projection, projectAnchor, projectField } from "../src/lib/align.js";

test("token map: surviving tokens keep their place, changed ones have none", () => {
  assert.deepEqual(tokenMap(["a", "b", "c", "d"], ["a", "x", "c", "d", "e"]), [0, -1, 2, 3]);
  assert.deepEqual(tokenMap(["a", "b"], []), [-1, -1]);
});

test("anchors move to before the next surviving token, the end stays the end", () => {
  const p = projection("Min tjener er død.", "Min gode tjener døde.");   // Min gode tjener døde
  assert.deepEqual(p.map, [0, 2, -1, -1]);
  assert.equal(projectAnchor(p, 1), 2);
  assert.equal(projectAnchor(p, 2), 4);
  assert.equal(projectAnchor(p, 4), 4);
});

test("link fields: positions projected, emptied links dropped, decisions kept", () => {
  const p = projection("a b c d", "a c d e");                              // b removed
  assert.equal(projectField(p, "0:0 1:1 2:1-3 3:3,1"), "0:0 2:1-2 3:2");
  assert.equal(projectField(p, "!4-5 u6 u7@2,8@-1 e9@1 +1,3>f2"), "!4-5 u6 u7@1,8@-1 e9@1 +2>f2");
  assert.equal(projectField(p, "+1"), "");
});
