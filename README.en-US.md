<div align="center">

# Lv Contacts (小驴人脉)

[![CI](https://github.com/ai68298100/siyuan-contacts/actions/workflows/ci.yml/badge.svg)](https://github.com/ai68298100/siyuan-contacts/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ai68298100/siyuan-contacts)](https://github.com/ai68298100/siyuan-contacts/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![SiYuan](https://img.shields.io/badge/SiYuan-%3E%3D%203.8.5-blue)

**Manage people and relationships in SiYuan: person records are documents backed by a native SiYuan database.**

**Latest stable release: v0.5.2** · [Download and install](https://github.com/ai68298100/siyuan-contacts/releases/tag/v0.5.2) · [Open an issue](https://github.com/ai68298100/siyuan-contacts/issues)

English | [简体中文](README.md)

<img src="preview.png" alt="Lv Contacts preview" width="640" />

</div>

---

Lv Contacts keeps people, relationships and shared experiences in your SiYuan workspace. Each person is a regular SiYuan document; structured profile fields live in a native database bound to that document, alongside SiYuan search, backlinks and sync.

## 🐴 Little Donkey plugin series

Currently developed plugins:

- [**小驴雷切**](https://github.com/ai68298100/siyuan-speed-switch)
- [**小驴打卡**](https://github.com/ai68298100/siyuan-checkin)
- **小驴人脉** (this project)
- [**小驴拾遗**](https://github.com/ai68298100/siyuan-glean)

Each plugin is maintained independently and can be used on its own or alongside the others.

## Features

| Area | What it does |
|---|---|
| Contact roster | Card and table views, search, groups, combined filters, saved views, profile completion, batch adoption of existing notes and suspected-duplicate hints |
| Contact import and entry | Import vCard 2.1/3.0/4.0 files and export vCard 3.0; recognize pasted business-card or chat text, selected editor text or a whole note |
| Person profiles | Self profile, aliases, relationship labels relative to you, a profile strip in person documents and a free-form note written back to each person document |
| Relationships and organizations | Two-way person relations, relationship and document-reference graphs, organizations, membership history, common background and graph queries |
| Interactions | Capture attendees from meeting notes; interaction timeline, reusable note templates, exchange ledger, review reports and meeting briefings |
| Reminders and follow-ups | Solar and lunar birthdays, contact cadence and inactivity reminders; follow-ups can sync with native SiYuan task blocks in person documents |
| Health and integrations | Read-only data health checks with jump-to actions; window.LvContacts lets other plugins search/create people and record shared experiences |
| Mobile layouts | Responsive workspace and fullscreen dialogs, covered by isolated mobile-viewport regression tests |

## Install

Manual installation from GitHub Releases is currently supported; the plugin is not listed in the SiYuan Marketplace.

1. Download package.zip from the [v0.5.2 Release](https://github.com/ai68298100/siyuan-contacts/releases/tag/v0.5.2).
2. Extract its contents into data/plugins/siyuan-contacts/ in your SiYuan workspace. plugin.json must be at that directory root.
3. Restart SiYuan and enable **Lv Contacts** under **Settings → Marketplace → Installed**.

Requires **SiYuan 3.8.5 or later**.

## Data and privacy

Person documents, per-person notes and the contact database are SiYuan workspace content. The plugin sends no telemetry. AI recognition runs only after an explicit user action and sends the relevant note content to the AI service configured in SiYuan.

Plugin-managed data includes interactions, follow-ups, cadence and reminder state, adoption dates, templates, exchanges, aliases, self identity, organization memberships and relationship labels. It is stored in SiYuan's plugin data directory and may be lost when that data is deleted. Export the plugin data migration bundle from **Settings → Export Center** before uninstalling or deleting plugin data.

The migration bundle is a JSON value snapshot with a preview and merge flow, not a workspace or byte-for-byte backup. It covers those 11 plugin-data modules, but excludes person and organization documents, the contact database, database anchors, UI preferences and unfinished operation checkpoints. A per-person note lives in its person document and is not exported as a separate bundle entry. To move to another workspace, migrate the SiYuan documents and database first, rebind the database in the plugin, then import the bundle. The plugin does not guess document identity by matching names.

## Known limitations

- Isolated viewport and kernel tests do not establish acceptance in a real host. A real user workspace, Android device, keyboard/safe-area behavior and actual multi-window use have not been verified.
- Opening SiYuan's native graph, task-manager interoperability and Marketplace availability have not been verified; use the manual installation steps above.
- The in-app English translation is incomplete, so some interface text may appear in Chinese.
- CardDAV address-book sync and CalDAV calendar sync are not supported. Contacts can be exchanged using vCard files.

See the [v0.5.2 release notes](docs/RELEASE-NOTES-v0.5.2.md) for validation scope.

## Quick start

1. Click the Lv Contacts toolbar icon and follow the wizard to create the contacts notebook and database.
2. Create a person, adopt existing notes, import a .vcf, or paste text to recognize profile details.
3. Add relationships, organization memberships, a per-person note or exchange records in the person detail.
4. In a meeting note, right-click and choose **Lv Contacts: capture people from this note** to record attendees and a shared occasion.
5. Review birthdays, contact reminders and follow-ups from the home view. Export the plugin data migration bundle before uninstalling.

## Development

Requires Node.js 24 or later and pnpm 12.x. Install dependencies and start SiYuan. Before the first hot-reload session, run pnpm make-link, then run pnpm dev.

Common checks: pnpm check, pnpm test, pnpm test:ui, pnpm test:ui:mobile, pnpm build and pnpm check:release. Mobile viewport tests do not replace real-device acceptance.

See [AGENTS.md](AGENTS.md) and the [handoff guide](docs/HANDOFF.md) for development conventions, the [data contract](docs/DATA-CONTRACT.md) for storage boundaries, and the [changelog](docs/CHANGELOG.md) for changes.

## Feedback and license

Report issues and request features in [GitHub Issues](https://github.com/ai68298100/siyuan-contacts/issues), including SiYuan/plugin versions, reproduction steps and redacted logs.

QQ group: **871707735**

[MIT License](LICENSE)
