# .tanakh: the source-side data every language repo shares

- `poetry/<BOOK>.json`: poetry line breaks keyed by the source word before which a line begins (`[word id, level, how]`;
  FORMAT.md section 5). Built from the BSB's lines (CC0) through the BSB translation tables (CC0) and the Hebrew-to-BSB
  verse map; word ids are MACULA's (Clear Bible / Biblica, CC BY 4.0). 55 books, 24,329 lines (2026-11-02): 23,735 keyed
  exactly by the gold alignment, 492 to the nearest word, 102 by a Jev question (`jev`, `jev?`), 6 unkeyed.
- `layout.json`: the pinned layouts (hebrew-clause-layout, greek-nt-clause-layout, revisions) and the MACULA spine release the
  clause keys come from. `migrations/`: one key map per layout upgrade (none yet).

These files are copied from the template when a language repository is created and updated by the bot; people do not
edit them.
