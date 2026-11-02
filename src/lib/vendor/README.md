# Vendored files

Copied verbatim; never edited here. To update, copy the new release over the file and run the tests.

| file | source | licence | sha256 |
|---|---|---|---|
| `tokenize.js` | Hugging Face dataset `bcv-commons/compact-alignments`, `tokenize.js` (identical to bcv-commons/bibles `tools/verse-text/js/tokenize.js`, release 2.0.0); generated from the Python reference, byte-for-byte equivalent to it | CC0 1.0 | ab333dee83cac25ef4e92938218bd928636726e75401f1c376282b7887b7c87d |

`tokenize.js` implements tokenizer version 3, the `tokenizer_version` of the dataset's `manifest.json` (checked 2026-11-02).
`src/lib/format.js` refuses to load if the two disagree (`TOKENIZER_VERSION`).
