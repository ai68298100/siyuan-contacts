# Lv Contacts (小驴人脉)

Manage people and relationships in [SiYuan](https://b3log.org/siyuan): **one person, one document**, backed by a native SiYuan database.

- Every contact is a regular SiYuan document — bidirectional links, search and sync all work as usual.
- Structured fields (birthday with lunar support, phone, email, WeChat, organization, how-we-met, tags, groups) live in a native database bound to each person document.
- Relationships between people are modeled with the database `relation` field (two-way).
- Workbench tab with dashboard, card/table views, relation graph (roadmap M2–M5).
- Birthday / anniversary reminders with lunar calendar support (roadmap M4).
- All data stays in your workspace — no cloud, no telemetry.

## Requirements

- SiYuan ≥ 3.8.5

## Development

```bash
pnpm install
pnpm build          # dist/ + package.zip
pnpm test           # node --test
pnpm spike          # isolated-kernel AV API verification
pnpm make-install   # copy dist into a running workspace
```

See `docs/DATA-CONTRACT.md` for the storage contract and `docs/DECISIONS.md` for architecture decisions.

## License

MIT
