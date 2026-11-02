# .github/check: the format checks CI runs

`../workflows/validate.yml` runs these on every pull request and every push to `main` and `approved` (FORMAT.md section 6).
They only read the repository.

- `layout_keys.py`: the clause keys of the pinned Hebrew layout (`.tanakh/layout.json`) per verse, from
  bcv-commons/hebrew-clause-layout at the pinned revision (MACULA Hebrew, CC BY 4.0). Needs pyarrow.
- `validate.mjs`: the checks. Run it locally from the repository root with `node .github/check/validate.mjs .`
  (add `--keys keys.json` from `layout_keys.py` to check the keys too).
- `format.js`, `vendor/tokenize.js`: copies of make-tanakh-review's `src/lib/format.js` and `src/lib/vendor/tokenize.js`, the
  same code the editor uses; its tests keep them identical. `tokenize.js` is the standard tokeniser as published in
  bcv-commons/compact-alignments (CC0).

Do not edit them here: they come from make-tanakh-review's `template/` and are updated with it.
