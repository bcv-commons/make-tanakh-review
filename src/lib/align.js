// The per-verse aligner (PLAN.md section 16.2), shared by the browser and the server. So far its first step only: projection.
// When a verse's text changes, the token indexes in its .align row and its .notes anchors are carried over to the new text by
// a diff of the two token sequences (the standard tokeniser's); a token that survived keeps its links, a changed or new token
// has none. The proposal step (lexeme store, MACULA gloss) comes later.
import { tokenize } from "./format.js";

// old token index -> new token index, or -1 for a token that did not survive (longest common subsequence of the token texts)
export function tokenMap(oldTokens, newTokens) {
  const n = oldTokens.length, m = newTokens.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i][j] = oldTokens[i] === newTokens[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const map = new Array(n).fill(-1);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (oldTokens[i] === newTokens[j]) { map[i] = j; i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return map;
}

// The projection of one verse: { map, n } from its old and new text.
export function projection(oldText, newText) {
  const a = tokenize(oldText), b = tokenize(newText);
  return { map: tokenMap(a, b), n: b.length };
}

const project = (p, i) => (i >= 0 && i < p.map.length ? p.map[i] : -1);

// An anchor ("before token a"; a = the token count means the end) moves to before the first surviving token at or after it.
export function projectAnchor(p, a) {
  for (let i = a; i < p.map.length; i++) if (p.map[i] >= 0) return p.map[i];
  return p.n;
}

const ids = (s) => s.split(",").flatMap((x) => { const [a, b] = x.split("-").map(Number); return Array.from({ length: (b ?? a) - a + 1 }, (_, k) => a + k); });
const spanText = (list) => {
  const s = [...new Set(list)].sort((x, y) => x - y), out = [];
  for (let i = 0; i < s.length;) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > i ? `${s[i]}-${s[j]}` : `${s[i]}`);
    i = j + 1;
  }
  return out.join(",");
};

// One field (main or function links) of an .align row, projected. `ord:positions` keeps the positions that survived (a link
// left with none is dropped: the Hebrew word becomes unlinked); `u`/`e` slots (`@pos`) move as anchors; `+pos[>ord]` added
// words keep the ones that survived; `!ords` and anything else is kept as it is.
export function projectField(p, field) {
  const out = [];
  for (const e of (field || "").split(" ").filter(Boolean)) {
    let m;
    if ((m = /^(\d+):([\d,-]+)$/.exec(e))) {
      const kept = ids(m[2]).map((i) => project(p, i)).filter((i) => i >= 0);
      if (kept.length) out.push(`${m[1]}:${spanText(kept)}`);
    } else if ((m = /^([ue])(\d.*)$/.exec(e))) {
      out.push(m[1] + m[2].split(",").map((it) => {
        const [o, slot] = it.split("@");
        return slot === undefined || Number(slot) < 0 ? it : `${o}@${projectAnchor(p, Number(slot))}`;
      }).join(","));
    } else if (e.startsWith("+")) {
      const items = e.slice(1).split(",").flatMap((it) => {
        const [pos, owner] = it.split(">");
        const to = project(p, Number(pos));
        return to < 0 ? [] : [owner === undefined ? `${to}` : `${to}>${owner}`];
      });
      if (items.length) out.push("+" + items.join(","));
    } else out.push(e);
  }
  return out.join(" ");
}

// An .align row after an edit of its verse: links projected, profile `s` (re-projected, not checked).
export function projectRow(p, row) {
  return { main: projectField(p, row.main), fn: projectField(p, row.fn), profile: "s" };
}
