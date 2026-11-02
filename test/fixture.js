// A small chapter in the published format (template/FORMAT.md) for the tests: JOS 1, verses 1-2, with its three sidecars and the
// text hash computed as the producer does.
import crypto from "node:crypto";

export const A = "060010010011-060010010061", B = "060010010071-060010010141", C = "060010010151-060010010152", D = "060010020011-060010020051";

export const VERSES = [["1:1", "Efter at Moses var død, sagde HERREN til Josva:"], ["1:2", "Min tjener er død."]];

export function hashOf(verses) {
  return crypto.createHash("sha256").update(verses.map(([r, t]) => `${r}:${t}`).join("\n"), "utf8").digest("hex");
}

export function chapterFiles(verses = VERSES) {
  const h = hashOf(verses);
  return {
    md: `---\nbook: JOS\nchapter: 1\nstatus:\n  maturity: "Udkast"\nstatus_labels: ["Modenhed"]\n---\n# Josvabogen, kapitel 1\n\n## Josva bliver leder\n`
      + verses.map(([r, t]) => `${r}\t${t}`).join("\n") + "\n",
    // 1:1 tokens: Efter(0) at(1) Moses(2) var(3) død(4) sagde(5) HERREN(6) til(7) Josva(8); 1:2: Min(0) tjener(1) er(2) død(3)
    units: `# units: aligned; layout bcv-commons/hebrew-clause-layout@x; token ranges of the standard tokeniser\n# text ${h}\n`
      + `1:1\t${A}:0-4 ${B}:5-8 ${C}:=\n1:2\t${D}:0-3\n`,
    notes: `# notes: verse, kind, anchor token, text\n# text ${h}\n1:1\tE\t5\tEn note.\n1:2\tT\t4\tSidste.\n`,
    align: `# full alignment, bcv-commons compact-alignments format (scripts/full_align.py)\n# text ${h}\n`
      + `1\t0:3 1:2-3 2:4 3:5 4:6 5:8\t1:0-1 2:7 u3@5 +4,7>2\tb\n2\t0:1 1:3\t0:0 1:2\tb\n`,
  };
}

export const files = (base, texts) => Object.fromEntries(Object.entries(texts).map(([ext, t]) => [`${base}.${ext}`, t]));
