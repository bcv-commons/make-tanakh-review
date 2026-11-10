# The chapter format (global-tanakh language repositories)

One chapter = up to four files in the book's folder, named `<BOOK>/<BOOK>_<CCC>.<ext>` (`GEN/GEN_020.md`). The text file
is the invariant; every other file refers to it by verse and token index, so a plain `git diff` of any file reads verse by
verse. Written 2026-11-02 (make-tanakh-review PLAN.md sections 15 and 16).

## 1. `<BOOK>_<CCC>.md`: the text

```
---
book: GEN
chapter: 20
status:
  maturity: "Udkast"
  translation: "Maskinudkast fra grundteksten, sammenholdt med Berean Standard Bible"
  exegesis: "Endnu ikke sket"
  literary: "Endnu ikke sket"
  date: "17.08.2026"
status_labels: ["Modenhed", "Oversættelse", "Eksegetisk bearbejdning", "Litterært tjek", "Dato for denne version"]
---
# Første Mosebog, kapitel 20

## Abraham og Abimelek
20:1	Abraham brød op derfra til Negev-landet ...
20:2	...
```

- **Front matter** (YAML between `---` lines): `book`, `chapter`, and the chapter's status fields under `status` with fixed
  keys (`maturity`, `translation`, `exegesis`, `literary`, `date`) and their labels in the language under `status_labels`.
  Values are JSON strings. Other keys may follow; the editor shows them as they are. People change the status in the editor,
  in their proposal like the text; every save sets `date` to the day of the save, in the form the file uses (`17.08.2026` or
  `2026-08-17`). The drafting side writes its machine status only on chapters without a status from people.
- **`# title`**: the chapter title, one line. **`## heading`**: a section heading; it stands before the verse line it precedes.
- **Verse lines**: `chapter:verse<TAB>text`, one verse per line, in ascending order, translatable text only: no verse
  markers, no notes, no line-break marks. A verse without text has an empty text field. Verse numbers follow the Hebrew
  (MACULA) numbering, as the clause keys do.
- Nothing else: no blank-line meaning, no other Markdown. A verse line is the whole verse; wrapping is the viewer's.

**Tokens** are the standard tokeniser's (bcv-commons compact-alignments tokenizer v2, the same as the bibles repository's
`bcv_tokenize`): NFC, combining marks dropped (except Myanmar), maximal runs of letters and marks; digits, punctuation and
spaces separate; scripts without spaces by rule. Tokens are numbered from 0 within the verse. A token index used as an
*anchor* means "before token a" (so `a` = the verse's token count means "at the end"). A text edit that changes only
punctuation or spacing moves no index.

## 2. `<BOOK>_<CCC>.align`: the alignment (sidecar 1)

The compact-alignments working file as the drafting agents deliver it (make-tanakh `scripts/full_align.py`), unchanged:

```
# full alignment, bcv-commons compact-alignments format (scripts/full_align.py)
# text <sha256>
1	0:0 1:1-2 2:4 ...	1:3 !2 +5	b
```

- Rows: `verse<TAB>main links<TAB>function links<TAB>profile`. A link is `ordinal:tokens` (ordinal of the Hebrew content or
  function token in MACULA order; tokens as `5`, `5-7`, `5,9`); decisions `!ord` (no target word), `u`/`e` (untranslated /
  rendered elsewhere), `+pos` (added target words).
- **Profile letters per verse**: `a` script, `b` agent, `h` checked by a person in the editor, `j` judged by Jev (with the
  user's own key), `s` seed projection (an edit moved the text and the links were re-projected, not checked). The editor
  writes `h`/`j`/`s`; a verse whose text changed and was not re-aligned is shown as *check*.
- **`# text <sha256>`** is the SHA-256 of the lines `chapter:verse:text` of the `.md`'s verse lines, joined by newline. It
  verifies the alignment against the text with no other file: a mismatch means a stale alignment, and CI refuses it.
  **Every sidecar** (`.units` and `.notes` too) carries this line in its header, so one check guards them all, and a
  pull request that changes the text without its sidecars cannot be merged (section 6). A commit id cannot serve here: a
  file cannot hold the id of the commit that contains it; the content hash is history-independent and does the same job.

## 3. `<BOOK>_<CCC>.units`: the clause units (sidecar 2)

```
# units: aligned; layout bcv-commons/hebrew-clause-layout@<revision>; token ranges of the standard tokeniser
# text <sha256>
20:1	010200010011-010200010052:0-5 010200010061-010200010081:6-12 010200010091-010200010112:=
20:2	010200020011-010200020031:0-3 010200020041-010200020091:4-9 010200020011-010200020031/2:10-14
```

- One line per verse: `chapter:verse<TAB>key:range key:range ...`, the keys in **Hebrew order** (the layout's segment
  order). A key is the clause's **span** `first-last`: the MACULA word ids (CC BY 4.0, credited in LICENSE) of its first and
  last word (the last over all segments of a discontinuous clause). The first word is the clause's identity (the layout's
  clause key); the last word is the check: when the pinned layout is upgraded, a clause whose span no longer matches was
  split, merged or moved, and the migration map in `.tanakh/migrations/<old>-<new>.json` (built by the drafting side's
  `migrate_keys.py`: same / grown / split / merged / moved per old clause) rewrites the keys and nothing else in the file.
  Hebrew ids have 12 digits (book, chapter, verse, word, part), Greek ids 11 (no part: MACULA Greek keeps crasis forms such
  as kago as one token, so Greek needs no part digit).
- `key:a-b` the unit's tokens (inclusive); `key:a-b,c` scattered (the first range is where the unit's line begins);
  `key:=` a clause with no words of its own (shown with the line before it).
- `key/2`, `key/3`: the layout's own second and third segment of a Hebrew clause that is discontinuous in the Hebrew (another
  clause stands inside it; the layout's clauses form a tree, `parent_key` and `depth` per row). All pieces share the key. A
  draft may render the whole clause at its first piece and write the later ones `=`; a reviewer's text may fill them. A key
  may appear more than once in a verse, and a later piece may stand in a later verse; the editor shows each piece's own
  Hebrew words.
  `key.2`: a translator's split of one Hebrew clause into two target units (`#` in the editor); `%` joins two keys into one
  unit, written as the first key owning the range and the second as `=`.
- Header: `authored` (the draft was written in clause lines matching the layout), `aligned` (a first cut from the `.align`
  file's votes), `edited` (people's cuts, from the editor). Cuts are made once; after that they belong to people.
  A re-draft proposal re-cuts only verses whose text changed.
- The repository's pinned layout: `.tanakh/layout.json` (the two layout datasets with their revisions, the MACULA spine release). Every key must exist in it.

## 4. `<BOOK>_<CCC>.notes`: inline notes (sidecar 3)

```
# notes: verse, kind, anchor token, text
# text <sha256>
20:2	T	7	Ordret: >>sendte bud og tog<<.
20:9	E	14	Jf. 1 Mos 12,18.
```

Kinds as the drafting pipeline uses them: `T` text-critical, `E` exegetical, `H` cross-reference, `N` note to the
reviewers. The anchor is the token the note follows. A note is one line (no newline in the text).

## 5. Poetry lines: keyed by the source, not a sidecar (`.tanakh/poetry/<BOOK>.json`, decided 2026-11-02)

Poetry line breaks are a property of the source text's layout, so they are kept once, keyed by the Hebrew or Greek word
before which a line begins, in the template's `.tanakh/poetry/<BOOK>.json` (shared by every language repo; built by the
drafting side's `poetry_layout.py` from the BSB's USFM `q` lines through the BSB translation tables, both CC0, read through
the Hebrew-to-BSB verse map; word ids MACULA, CC BY 4.0). A viewer places a break before the target token linked to that
word through the chapter's `.align`, or at the unit boundary when the word begins a clause (`how` = `clause`); a text
without alignment is shown as prose. Each entry is `[word id, level, how]`, `how` = `clause` or `word` (the line begins
exactly where the word's rendering begins: 97.6% of the 24,329 lines), `in` or `next` (keyed to the nearest word, 2.0%),
`jev` / `jev?` (keyed by a Jev question where the gold alignment has none, Daniel's Aramaic above all; p >= 0.8 / 0.5-0.8;
0.4%). Six lines of the BSB remain unkeyed. No language repo carries a layout file.

## 6. What CI checks on every pull request (validation only; nothing is rewritten)

- The `.md` parses: front matter, verse lines ascending, no verse twice, no text outside the forms above.
- Every sidecar's `# text` hash matches the `.md` (the one check that keeps text and sidecars in step; required status
  check on `main` and `approved`, no direct pushes). `.align`: profile letters from the list; token positions inside the verse.
- `.units`: every key in the pinned layout, Hebrew order, no key twice, ranges inside the verse, each token in at most
  one unit.
- `.notes`: anchors inside the verse (0 .. token count).
- No secrets, no files outside the forms above (a PR that touches other files is merged on github.com only).
- Alternative drafts (section 9) get every check above, and: `alternative:` equal to the folder's kind, `built:` a date,
  `# units: authored`, all four files present, a README line per kind, no other file under `.tanakh/alternatives/`. A pull
  request that touches them gets a notice (only the publisher writes them). `layout_keys.py` takes their books too.
- Derived files (the alternatives, `.tanakh/runs/`, `.parts`, `.feats`): a pull request by anyone but the publisher
  (`.tanakh/publisher.json` `login`) that touches them gets a notice.
- `.parts` (section 12): the header; per row its verse (a row whose verse hash does not match is stale: a notice, not an
  error), one cell per token, readable pieces that give the token.
- Edit records (section 10): the file name, each line a JSON object, `who` the file's login, `op`, `cat` and `scope` from the
  lists, `ref` a verse of the chapter. `.tanakh/language.json` (section 11): its three keys.

## 7. Derived formats

Plain verse text (`chapter:verse<TAB>text`, the `.md` without front matter and headings), USFM, and the drafting pipeline's
own chapter file are **built** from these files by the `index` repository's workflow and published there; they are never
kept beside the sources.

## 8. Glosses: the language's commonest renderings per Hebrew lexeme (`.tanakh/glosses.json`, decided 2026-11-04)

Counted by the drafting side (make-tanakh-grammar) from the drafted chapters' `.align` links and published with them, in the
same pull request; the editor shows them under the Hebrew words (in italics where the draft has no link of its own) and in
the word's hover text. Counts only: no verse text, nothing per word position. CC0 like the rest of the repo; the lexemes are
MACULA's (CC BY 4.0) through the spine.

```json
{
  "format": "make-tanakh-glosses/1",
  "language": "dan",
  "source": { "repo": "larsgson/make-tanakh-work", "commit": "a6d582a", "editions": ["dan_BSB"], "chapters": 431 },
  "licence": "CC0-1.0 (counts from our drafts); lexemes: MACULA Hebrew (WLC) via lexeme-spine-macula, CC BY 4.0",
  "lexemes": { "hbo:0430": [["gud", 846], ["guds", 417], ["guder", 83]], "hbo:0871a": [["i", 2800], ["på", 892]] }
}
```

- Keys: the spine's lexemes with their prefix (`hbo:`, `grc:`), content and function words (the `.align` main and fn links).
- Forms: lower-cased, as the drafts write them; a rendering of several words is one form; the commonest first; at most 8 per
  lexeme; forms seen once are kept (the editor trims).
- Counted: the language's drafted chapters, the main drafts only (never `_eval/`, never `.tanakh/alternatives/`, nothing that
  has not passed the publishing screen).
- The editor finds a word's lexeme in compact-alignments' source index (`_index/<BOOK>_lexemes.json` beside `_keys.json`,
  `_fn.json` beside `_fn_keys.json`). A repo without the file falls back to lexeme-aligner's counts over the language's Bible
  editions (bcv-commons/lexeme-alignments `iso=<iso>/top.json`, format `lexeme-glosses/1`, at a revision pinned in the editor);
  from those, a word that is only a function morpheme is shown only when one form holds half its count.

## 9. Alternative drafts: the same chapter by other methods (`.tanakh/alternatives/`, decided 2026-11-09)

Besides the main draft that reviewers edit, the drafting side (make-tanakh-grammar) publishes drafts of the same chapter made
by other methods (today `nllb`, a translation model fine-tuned on the team's text, and `shape`, every word taken from the
team's usage). They are weaker overall but each is the best for some clauses; the editor shows them under each clause, read
only, and shades the main text's words by how many of them have the word.

```
.tanakh/alternatives/README.md                         one line per kind and book range
.tanakh/alternatives/<kind>/<BOOK>/<BOOK>_<CCC>.md     the alternative's text
.tanakh/alternatives/<kind>/<BOOK>/<BOOK>_<CCC>.units  its clause units
.tanakh/alternatives/<kind>/<BOOK>/<BOOK>_<CCC>.notes  its notes (may hold only the header)
.tanakh/alternatives/<kind>/<BOOK>/<BOOK>_<CCC>.align  its alignment to the Hebrew (profile a)
```

- `<kind>` matches `[a-z0-9-]+`. The four files follow sections 1 to 4 unchanged (same tokeniser, the text hash in every
  sidecar header, the clause keys of the pinned layout), with `# units: authored`. The front matter has two more keys:
  `alternative: "<kind>"` (the folder's name) and `built: "YYYY-MM-DD"`; `status.maturity` is the language's "Machine draft",
  `status.translation` describes the generator.
- README lines: ``- `<kind>` (<BOOK> <chapters>): <generator, model>; built <date>``.
- Never edited. Only the publisher (`.tanakh/publisher.json`) writes them; a rebuild replaces a kind's chapter as a whole. A
  chapter may lack any alternative, a kind may lack some chapters. A clause an alternative has no words for is `key:=` in its
  `.units`, explained by an `N` note.
- **No agreement file.** The editor computes the agreement from the current files every time, also after edits (a stored copy
  would go stale with any edit to the chapter, and a rule change would mean republishing every repository):
  1. Tokens: the standard tokeniser (section 1) on the verse text, each token lower-cased and NFC.
  2. A unit's clause: its key without a `/n` segment and a `.n` split. A main unit takes in the keys written `=` right after it
     in the same verse (its joined clauses).
  3. An alternative's words for a clause: the tokens of all its units in the same verse whose key reduces to that clause, by
     their ranges. If all of them are `=`, or the clause is missing, that alternative has nothing for it and does not count.
     For a main unit of several clauses, the alternative's words for any of them.
  4. Per token of a main unit: support = the alternatives (of those with words for the clause) whose words contain it;
     available = how many have words for the clause.
  5. Shading: available 0, none; support 0, strong (no other draft says this); between, light; support = available, none.
  Membership is exact after step 1: another wording of the same meaning is no support. Repeated tokens are checked each on
  its own (a set, not counts). Nothing crosses a verse. After an edit the shading compares the reviewer's wording.

## 10. Edit records: what reviewers changed (`.tanakh/edits/`, decided with make-tanakh-grammar 2026-11-10)

Every save in the editor writes, in the same commit as the chapter, one file of rows describing the save's changes against the
text it started from, so the drafting side can learn from them. The file travels in the proposal and reaches `main` only when
the proposal is merged. One file per save, so two proposals never touch the same file:

```
.tanakh/edits/<BOOK>/<BOOK>_<CCC>/<yyyymmddThhmmssZ>-<login>.jsonl
{"ref":"1:1","unit":"060010010071-060010010141","who":"ann","when":"2026-11-10T08:15:30.123Z","scope":"this","entry":null,
 "draft":null,"why":null,"commit":"<the commit edited>","op":"R","cat":"NEW","span":{"old":[5,6],"new":[5,6]},"old":"sagde",
 "new":"talte","quote":{"prefix":"Moses var død","suffix":"HERREN til Josva"},"from_alt":null}
```

- One row per changed stretch of a verse, by the longest common subsequence of the tokens' surfaces (the text a token covers,
  combining marks included). `span`: token positions `[from, to)` in the old and the new verse; `old`, `new`: the text they
  cover; `quote`: up to three tokens before and after in the new verse; `unit`: the unit (as `.units` writes it) that holds it.
- `op` (ERRANT's): `M` words added, `U` words removed, `R` replaced, `WO` the same words in another order.
- `cat`: `TONE` only combining marks differ; `SPELL` case, or a small edit distance (at most a quarter of the word, at least
  1); `FUNC` the old words were a function word's rendering (the `.align` function links); `NEW` a word not known in the
  language (the glosses' forms, the chapter's words); `WORD` another known word; `ORDER` (with `WO`); `SPLIT`, `JOIN` the clause
  cut of the verse changed (`old`, `new`: the units' clauses, `|` between units); `CHOICE` a verse both sides changed, settled
  by the author when bringing in the working text (`choice`: `ours` = their own, `theirs` = the working text); `OTHER`
  punctuation or spacing only. `AFFIX` is given by the drafting side at intake (it needs the word's parts).
- `from_alt`: the alternative (section 9) whose words the reviewer put in the unit with "use", if any. `scope` is `this` (a
  question "only here, or for clauses like this?" may make it `similar`); `entry` a register entry, `draft` the run that made
  the main draft (`.tanakh/runs/<BOOK>_<CCC>.json` `drafts.<kind>.run`, the kind `main`, else the one kind that is not an
  alternative), `why` the reviewer's own words, all optional.
- Written by the editor only, never edited; the drafting side reads them at tagged revisions.

## 11. The language (`.tanakh/language.json`)

```json
{ "code": "dan", "name": "Danish", "native": "dansk", "bcp47": "da" }
```

`code` the ISO 639-3 code (the repository's name); `name` in English; `native` optional; `bcp47` the tag for spell checking and
fonts (the two-letter code where there is one). Written when the repository is made (`tools/init_language.sh`).

## 12. Word parts (`<BOOK>_<CCC>.parts`, derived; make-tanakh-parts/1, agreed with make-tanakh-grammar 2026-11-10)

Written by the publisher beside a chapter (and beside an alternative), never edited; rebuilt at the drafting side's intake.

```
# parts: make-tanakh-parts/1; splitter morphs.py@<12 hex> bcv_segment.py@<12 hex> seg_facts.json@<12 hex>; unicode <version>
1:1	6ec2d3f5	0=Omu:whole	1=...	4=ba:p2:m:ba-sm:verb|ka:p3:m:ka-pst:verb|ba:stem
```

- A row per verse: `c:v`, the verse hash (the first 8 hex of the SHA-256 of `c:v<TAB><verse text>`), one cell per token of the
  standard tokeniser, `n=<pieces>`. No `# text` line: a verse whose hash no longer matches is stale (a CI notice); the other
  rows stay valid.
- Pieces, joined by `|`: `<text>:<slot>[:<morph id>]`, slot `whole`, `stem`, `p<n>`, `s<n>`, `i<n>` (prefix, suffix, infix by
  position); the morph id names a register entry. A tone piece `:tone[:<label>]@<pos>:<mark>;...` (pos in letters from the
  word's end). The pieces' texts joined, the tone marks put back, give the token (NFC).

## 13. The drafting side's other files

- `.tanakh/runs/<BOOK>_<CCC>.json`: `{ book, chapter, drafts: { <kind>: { run, label, model, prompts sha256, code, register,
  built } } }`, which run made each draft (section 10's `draft`).
- `.tanakh/clause-features.json`: a pointer, not values: the clause features "clauses like this" match on are in the CC BY-SA
  dataset bcv-commons/clause-columns, which never enters a language repo (CC0). The file names the dataset, its revision, the
  file and its SHA-256, the layout it is keyed by, the join (a `.units` key's part before `-` is the dataset's `clause_key`;
  all pieces `/n` share it), and the columns to match on.
- `.tanakh/publisher.json`: `{ login, name, url }`. These, the alternatives and `.parts` are derived: a pull request by anyone
  but the publisher's `login` that touches them gets a notice.

