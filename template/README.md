# Tanakh drafts (LANG_NAME): clause by clause

Drafted Tanakh chapters, one verse per line (`<BOOK>/<BOOK>_<CCC>.md`, FORMAT.md), edited with
[make-tanakh-review](https://github.com/bcv-commons/make-tanakh-review), clause by clause along the Hebrew. The Hebrew clauses
are named by the word identifiers of MACULA Hebrew (Clear Bible / Biblica, CC BY 4.0), as laid out by bcv-commons'
hebrew-clause-layout (Hebrew Bible Clause Layout v0.37, bcv-commons, segmentation CC BY 4.0).

- `main`: the working text; anyone's proposal (a pull request) is merged here by a reviewer, verse by verse.
- `approved`: the text the language team has approved, chapter by chapter.
- `<BOOK>/<BOOK>_<CCC>.align`, `.units`, `.notes`: the alignment to the Hebrew, the clause units and the drafters' notes, one
  line per verse, written by the pipeline and the editor, never by hand (FORMAT.md). Poetry lines come from the Hebrew's
  layout, shared by all languages (`.tanakh/poetry/`).
- Every pull request and push is checked against FORMAT.md (`.github/workflows/validate.yml`; it only reads).

**Licence: CC0 1.0** (LICENSE). Every edit is given under CC0 (CONTRIBUTING.md). Drafts arrive from the make-tanakh pipeline:
a new chapter is added as it is; a re-draft of an existing chapter comes as a pull request, never as an overwrite.

Part of the [global-tanakh](https://github.com/global-tanakh) organisation: one repository per language.
