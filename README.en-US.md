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

> 🔒 **Data sovereignty**: contact documents and databases live in your SiYuan workspace, with no plugin telemetry. Explicit AI analysis sends note content to your configured SiYuan AI endpoint. Uninstalling does not delete person documents, but back up plugin-owned interactions first. SiYuan sync remains under your control.

## ✨ Features

- 🗂 **Contact management** — card & table views (iOS-style segmented switch), instant search, groups and tags; batch-adopt existing notes as contacts; searchable people pickers (keyboard navigation); profile-completeness screening with guided backfill; per-view table column visibility/order preferences (name column fixed); suspected-duplicate candidates (advisory only, no silent merging)
- 🔍 **Combined filters & saved views** — tag match all/any, interaction date ranges, never-contacted; visible active conditions clearable one by one; save frequently used conditions as named views, re-evaluated against the current roster on apply
- 💼 vCard import/export with per-item import reports (imported / skipped / failed / needs-review) and roster-checked retry
- 🪄 **Paste to recognize** — paste business-card text, chat logs or key-value lists when creating/editing a contact for local parsing with a grouped preview (conflicts left untouched by default); right-click in the editor to recognize a selection or the whole document; AI structured candidates with grouped confirmation
- 🧑‍🤝‍🧑 **Relationships** — two-way `relation` fields (backlinks maintained by the kernel) + Cytoscape graph with direct/second-degree highlighting, mutual-contact and shortest-path queries within the displayed graph; chain-style path rendering with Markdown export; filter people with no valid relationships in the full roster
- 📝 **Capture from notes** — link people in a meeting note, then capture attendees, shared occasion (date/place) and an attendees block with one click; optional AI extraction of unlinked names
- 🎂 **Birthday reminders** — solar & lunar birthdays, upcoming-birthday and "haven't talked in a while" dashboard; per-person cadence overrides or pause; inline "skip this year / snooze / never remind", with a grace period for newly adopted contacts
- ✅ **Follow-ups & action list** — dated contact plans (snooze with semantic options / complete / cancel / reopen) surfaced in a today action list that merges birthdays, cadences and follow-ups per person, grouped by reason with inline handling and undo; follow-ups can sync to **native task blocks** in the person document with two-way convergence; bulk postpone-overdue-to-today; an opening summary banner is dismissible for the day
- 📄 **Person document strip** — open a contact's document to see and edit their profile inline; export a meeting briefing as Markdown (profile / recent interactions / open follow-ups / key dates / related people / shared occasions)
- 📊 **Interaction review report** — interaction counts, shared-occasion counts, contacted people and source distribution per month or custom range; Top rankings and previous-period comparison with explainable metrics
- 📝 **Interaction history & templates** — 20 per page, search, source filters, date ranges, month grouping and "on this day"; confirmed per-person deletion that preserves other participants; reusable note templates with local variables
- 🩺 **Data health audit** — ten-point read-only inspection in Settings (missing fields, suspicious birthdays, dangling relations, unreachable follow-ups, orphan interactions, suspected duplicates, long-inactive…), each explained with a jump-to action
- 🔌 **People service bridge** — other plugins get `window.LvContacts` to search/create people and record shared interactions ([protocol docs](docs/BRIDGE.md))
- 🛟 **Backup & restore** — JSON snapshots for interactions and follow-ups plus a **full migration bundle** (interactions + follow-ups + cadences + dismissals + registry + templates) with previewed merge; export center in Settings; these are not byte-for-byte file backups
- 📱 Responsive layouts and fullscreen dialogs have mobile viewport regression coverage; real-device touch and keyboard acceptance is still pending.

## 📦 Install

1. Download `package.zip` from [Releases](https://github.com/ai68298100/siyuan-contacts/releases)
2. Extract into your SiYuan workspace at `data/plugins/siyuan-contacts/`
3. Restart SiYuan → Settings → Marketplace → Download → enable **Lv Contacts**
- Requires **SiYuan ≥ 3.8.5**. Marketplace submission is deferred.

The source is **v0.3.0** (four batches of real-usage feedback shipped on top of v0.2.1, see [CHANGELOG](docs/CHANGELOG.md)), plus a full **visual refresh**: a motion system (button press feedback, hover lift, popover entrances — honors reduced-motion), iOS-style segmented controls, glass popover surfaces, gradient stat cards, and a floating graph toolbar over a dot-grid canvas; light and dark themes fully covered. Feature highlights: searchable people pickers, mobile toolbar & card layout, paste-to-recognize with local parsing, AI structured capture candidates, action-list grouping with inline handling & snooze/dismiss + undo, onboarding grace period, profile-completeness screening with guided backfill, ten-point data health audit, full migration bundle (interactions + follow-ups + cadences + dismissals + registry + templates), follow-ups synced to native task blocks in person documents (bidirectional), anchor re-discovery after notebook rename/move, and cross-window refresh notices. Real-host, real-device and marketplace submission remain gated per [RELEASE](docs/RELEASE.md).

## 🚀 Quick start

1. Click the toolbar icon → the wizard creates your contacts notebook and database
2. Create contacts (or **paste-and-recognize** business-card / chat text), batch-adopt existing notes via **Import**, or import a `.vcf`
3. Add relations in the person detail dialog; explore the graph view
4. Right-click inside a meeting note → *Lv Contacts: capture people from this note*
5. Export interactions from Settings before uninstalling. Review additions, skipped entries and deletion effects before confirming a backup merge. Safe database unbinding preserves person documents and interactions.

## 🛠 Development

```bash
pnpm install
pnpm dev        # watch build + hot reload into SiYuan
pnpm check      # tsc + svelte-check
pnpm test       # domain unit tests + architecture guards + i18n parity
pnpm test:ui    # isolated desktop browser regression
pnpm test:ui:mobile # mobile viewport regression, not device acceptance
pnpm build      # dist/ + package.zip
pnpm check:release # package release gate
```

See [AGENTS.md](AGENTS.md) for the development protocol, [docs/DATA-CONTRACT.md](docs/DATA-CONTRACT.md) for the storage contract and [docs/ROADMAP.md](docs/ROADMAP.md) for the roadmap. Changelog: [docs/CHANGELOG.md](docs/CHANGELOG.md). 中文文档见 [README.md](README.md)。

## 📄 License

[MIT](LICENSE)
