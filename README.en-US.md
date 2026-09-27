<div align="center">

# Lv Contacts (小驴人脉)

[![CI](https://github.com/ai68298100/siyuan-contacts/actions/workflows/ci.yml/badge.svg)](https://github.com/ai68298100/siyuan-contacts/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ai68298100/siyuan-contacts)](https://github.com/ai68298100/siyuan-contacts/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![SiYuan](https://img.shields.io/badge/SiYuan-%3E%3D%203.8.5-blue)

**Manage people and relationships in SiYuan: one person, one document, backed by a native SiYuan database.**

English | [简体中文](README.md)

</div>

---

## Why this plugin

Phone contacts only store numbers; sales CRMs only serve pipelines. **People are part of your notes** — attendees in meeting notes, friends from a party, day-to-day interactions in your journal. They should live in your knowledge base, not in yet another app.

Lv Contacts makes **every contact a regular SiYuan document** (bidirectional links, search and sync work as usual), while structured fields live in a [native SiYuan database](https://github.com/siyuan-note/siyuan) bound to each document. The plugin turns that into a proper management workspace.

> 🔒 **Data sovereignty**: everything stays in your workspace — no cloud, no telemetry. Contacts survive plugin uninstall.

## ✨ Features

- 🗂 **Contact management** — card & table views, instant search, groups and tags; batch-adopt existing notes as contacts
- 🧑‍🤝‍🧑 **Relationships** — two-way `relation` fields (backlinks maintained by the kernel) + Cytoscape graph colored by group
- 📝 **Capture from notes** — link people in a meeting note, then capture attendees, shared occasion (date/place) and an attendees block with one click; optional AI extraction of unlinked names
- 🎂 **Birthday reminders** — solar & lunar birthdays, upcoming-birthday and "haven't talked in a while" dashboard
- 📄 **Person document strip** — open a contact's document to see and edit their profile inline
- 🔌 **People service bridge** — other plugins get `window.LvContacts` to search/create people and record shared interactions ([protocol docs](docs/BRIDGE.md))
- 📱 Mobile support (fullscreen dialogs)

## 📦 Install

1. Download `package.zip` from [Releases](https://github.com/ai68298100/siyuan-contacts/releases)
2. Extract into your SiYuan workspace at `data/plugins/siyuan-contacts/`
3. Restart SiYuan → Settings → Marketplace → Download → enable **Lv Contacts**
- Requires **SiYuan ≥ 3.8.5** (marketplace listing under review)

## 🚀 Quick start

1. Click the toolbar icon → the wizard creates your contacts notebook and database
2. Create contacts, or batch-adopt existing notes via **Import**
3. Add relations in the person detail dialog; explore the graph view
4. Right-click inside a meeting note → *Lv Contacts: capture people from this note*

## 🛠 Development

```bash
pnpm install
pnpm dev        # watch build + hot reload into SiYuan
pnpm check      # tsc + svelte-check
pnpm test       # domain unit tests + architecture guards + i18n parity
pnpm build      # dist/ + package.zip
```

See [AGENTS.md](AGENTS.md) for the development protocol, [docs/DATA-CONTRACT.md](docs/DATA-CONTRACT.md) for the storage contract and [docs/ROADMAP.md](docs/ROADMAP.md) for the roadmap. 中文文档见 [README.md](README.md)。

## 📄 License

[MIT](LICENSE)
