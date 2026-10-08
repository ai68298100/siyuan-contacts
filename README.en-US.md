<div align="center">

# Lv Contacts (小驴人脉)

[![CI](https://github.com/ai68298100/siyuan-contacts/actions/workflows/ci.yml/badge.svg)](https://github.com/ai68298100/siyuan-contacts/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ai68298100/siyuan-contacts)](https://github.com/ai68298100/siyuan-contacts/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![SiYuan](https://img.shields.io/badge/SiYuan-%3E%3D%203.8.5-blue)

**Manage people and relationships in SiYuan: one person, one document, backed by a native SiYuan database.**

**Latest stable release: v0.4.1** · [Install from GitHub Releases](https://github.com/ai68298100/siyuan-contacts/releases) · [Open an issue](https://github.com/ai68298100/siyuan-contacts/issues)

English | [简体中文](README.md)

</div>

---

## 🐴 Xiaolv plugin family

Currently developed plugins:

- **小驴雷切**
- **小驴打卡**
- **小驴人脉** (this project)
- **小驴拾遗**

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
- 🧑 **Self profile** — onboarding creates a "Myself" person document with an identity mark; rosters and stats exclude yourself automatically; designate or rebind the self profile from Settings
- 🏢 **Organizations** — register companies/schools as org documents (kept out of the contacts database); memberships support multiple orgs, multiple tenures and active/former status; workspace orgs view, org manager dialog (rename/archive/restore/member editing); add or remove memberships right from the person detail; **common background** shows people sharing an org with overlapping periods (unknown dates are marked "same org" only — never inferred as "same period")
- 🕸 **Dual graph** — switch between "Relations" (explicit edges) and "Doc references" (native kernel graph data, centered on you / a contact / all registered docs) with remembered preferences; org nodes and membership edges rendered separately from relation edges; narrow by organization, scale trimming and edge-source labeling
- 📝 **Capture from notes** — link people in a meeting note, then capture attendees, shared occasion (date/place) and an attendees block with one click; optional AI extraction of unlinked names
- 🎂 **Birthday reminders** — solar & lunar birthdays, upcoming-birthday and "haven't talked in a while" dashboard; per-person cadence overrides or pause; inline "skip this year / snooze / never remind", with a grace period for newly adopted contacts
- ✅ **Follow-ups & action list** — dated contact plans (snooze with semantic options / complete / cancel / reopen) surfaced in a today action list that merges birthdays, cadences and follow-ups per person, grouped by reason with inline handling and undo; follow-ups can sync to **native task blocks** in the person document with two-way convergence; bulk postpone-overdue-to-today; an opening summary banner is dismissible for the day
- 📄 **Person document strip** — open a contact's document to see and edit their profile inline; export a meeting briefing as Markdown (profile / recent interactions / open follow-ups / key dates / related people / shared occasions)
- 🗒 **Per-person notes** — keep a free-form note for each person; it is written back to that person's document and excluded from interaction metrics. Edit, clear and retry after a conflict or failed read-back.
- 📊 **Interaction review report** — interaction counts, shared-occasion counts, contacted people and source distribution per month or custom range; Top rankings and previous-period comparison with explainable metrics
- 📝 **Interaction history & templates** — 20 per page, search, source filters, date ranges, month grouping and "on this day"; confirmed per-person deletion that preserves other participants; reusable note templates with local variables
- 🩺 **Data health audit** — ten-point read-only inspection in Settings (missing fields, suspicious birthdays, dangling relations, unreachable follow-ups, orphan interactions, suspected duplicates, long-inactive…), each explained with a jump-to action
- 🔌 **People service bridge** — other plugins get `window.LvContacts` to search/create people and record shared interactions (protocol v2; see the [protocol docs](docs/BRIDGE.md))
- 🛟 **Backup & restore** — JSON snapshots for interactions and follow-ups plus a **full migration bundle** (interactions + follow-ups + cadences + dismissals + registry + templates) with previewed merge; export center in Settings; these are not byte-for-byte file backups
- 📱 Responsive layouts and fullscreen dialogs have mobile viewport regression coverage; real-device touch and keyboard acceptance is still pending.

## 📦 Install

1. Download `package.zip` from [Releases](https://github.com/ai68298100/siyuan-contacts/releases).
2. Extract its contents into `data/plugins/siyuan-contacts/` in your SiYuan workspace; `plugin.json` must be at that directory root.
3. Restart SiYuan and enable **Lv Contacts** under **Settings → Marketplace → Installed**. A manual install will not appear in the Marketplace download list.
- Requires **SiYuan ≥ 3.8.5**. Marketplace submission is deferred.

Before uninstalling, export the interaction backup or full migration bundle from Settings. Person documents remain in the SiYuan workspace; interactions, follow-ups, reminders and templates are plugin-managed data and should not be treated as native SiYuan backups.

The current release baseline is **v0.4.1** (a load-fix on top of v0.4.0 plus data-trust hardening and three major capabilities over v0.3.0 — self profile, organizations and the dual graph, see [CHANGELOG](docs/CHANGELOG.md)). Treat the `package.zip` attached to GitHub Releases as the installable build; later development changes wait for the next Release.

- **Self profile (B11)** — auto-created "Myself" document + identity mark + roster exclusion + rebinding from Settings
- **Organizations (B13)** — org documents with a membership index (multiple orgs / tenures / active-former), workspace orgs view, org manager dialog (rename / archive-restore / member editing), direct membership editing in person detail, common-background projection
- **Dual graph (B14)** — graph view "Relations / Doc references" dual modes (native kernel graph data, three scopes), org nodes and membership edges rendered separately, narrow-by-organization
- **Data-trust hardening (P0)** — fourteen closing items: explicit read failures, backup reliability, close guards, lock retry, API boundaries, AI safe writes, onboarding breakpoints, recognition adjudication, relation concurrency, anchor disambiguation and more

Real-host, real-device and marketplace submission remain gated per [RELEASE](docs/RELEASE.md).

CardDAV address-book sync and CalDAV calendar/follow-up reminders are roadmap candidates only; v0.4.1 supports vCard file import/export, not online sync. Any future sync will be introduced after server compatibility, credential handling, field allowlists, conflict and deletion policies are verified.

## 🚀 Quick start

1. Click the toolbar icon → the wizard creates your contacts notebook and database
2. Create contacts (or **paste-and-recognize** business-card / chat text), batch-adopt existing notes via **Import**, or import a `.vcf`
3. Add relations in the person detail dialog; explore the graph view. Use the **per-person note** field for special circumstances; saving writes it back to the person document.
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
pnpm spike      # isolated SiYuan API probes
pnpm spike:init  # initialization resume probe
node scripts/e2e/contacts-flow.mjs # isolated-kernel contact flow
pnpm build      # dist/ + package.zip
pnpm check:release # package release gate
```

See [AGENTS.md](AGENTS.md) for the development protocol, [docs/DATA-CONTRACT.md](docs/DATA-CONTRACT.md) for the storage contract and [docs/ROADMAP.md](docs/ROADMAP.md) for the roadmap. Changelog: [docs/CHANGELOG.md](docs/CHANGELOG.md). 中文文档见 [README.md](README.md)。

## 🤝 Feedback & contributing

- Report bugs and request features in [GitHub Issues](https://github.com/ai68298100/siyuan-contacts/issues), including the SiYuan/plugin versions, reproduction steps and redacted logs.
- Before changing code, read [AGENTS.md](AGENTS.md), the [data contract](docs/DATA-CONTRACT.md) and the [handoff guide](docs/HANDOFF.md). Claims about real-host, device or multi-window behavior should include matching evidence.

## 🤝 Community

QQ group: **871707735**

## 📄 License

[MIT](LICENSE)
