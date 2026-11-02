# Migrations

One map per layout upgrade, `<old revision>-<new revision>.json`, built by the drafting side's `migrate_keys.py map`; the bot
applies it to every `.units` file of every language repository (`migrate_keys.py apply --write`), then updates `layout.json`.
None yet (2026-11-02).
