<div align="center">

# Lv Contacts (小驴人脉)

[![CI](https://github.com/ai68298100/siyuan-contacts/actions/workflows/ci.yml/badge.svg)](https://github.com/ai68298100/siyuan-contacts/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ai68298100/siyuan-contacts)](https://github.com/ai68298100/siyuan-contacts/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![SiYuan](https://img.shields.io/badge/SiYuan-%3E%3D%203.8.5-blue)

**Keep your contacts, relationships, organizations, and interactions in your SiYuan knowledge base.** Each person is a regular SiYuan document; the contact roster and structured profile fields are managed through SiYuan's native database.

**Latest stable release: v0.5.0** · [Download](https://github.com/ai68298100/siyuan-contacts/releases/latest) · [Changelog](docs/CHANGELOG.md) · [Report an issue](https://github.com/ai68298100/siyuan-contacts/issues)

English | [简体中文](README.md)

<img src="preview.png" alt="Lv Contacts preview" width="640" />

</div>

---

## Features

- **Contact profiles** — card and table rosters, search and filters with saved views, batch adoption of existing notes, paste recognition, vCard import/export, aliases, relationship labels, per-person notes, profile strips, and meeting briefings.
- **Relationships and organizations** — two-way contact links, relationship and document-reference graphs, organization membership with multiple tenures, member management, and shared-background views.
- **Interaction records** — capture attendees and shared occasions from meeting or party notes; browse a per-person timeline; track money, items, or favors as receivables and payables in the exchange ledger.
- **Reminders and follow-ups** — solar and lunar birthdays, contact cadence, follow-up plans, and a daily action list. Follow-ups can sync with native SiYuan task blocks in person documents.
- **Review and data health** — interaction reports, read-only profile checks, actionable findings, and links to the relevant records.
- **Backup and integration** — export interaction backups or a plugin-data migration bundle. Other plugins can search/create contacts and record shared occasions through `window.LvContacts`; see the [People Service Bridge](docs/BRIDGE.md).
- **Optional AI assistance** — note content is sent to your configured SiYuan AI endpoint only when you explicitly start an analysis. The plugin has no telemetry.

## Install

Requires **SiYuan 3.8.5 or later**. Search for “小驴人脉” in the SiYuan Bazaar. If it is not yet visible in your client, install the latest GitHub Release manually:

1. Download [`package.zip` from the latest Release](https://github.com/ai68298100/siyuan-contacts/releases/latest).
2. Extract its contents into `data/plugins/siyuan-contacts/` in your SiYuan workspace. `plugin.json` must be directly inside that directory.
3. Restart SiYuan and enable **Lv Contacts** under **Settings → Bazaar → Installed**. A manual install will not appear in the Bazaar download list.

## Quick start

1. Click the people icon in the SiYuan toolbar and follow the setup wizard to create the contacts notebook and database.
2. Create a person, batch-adopt existing documents, import a `.vcf`, or paste business-card text for recognition.
3. Add relationships, organization memberships, interactions, and a personal note in the person details. The note is written to that person's document.
4. Link people in a meeting note, then use the context menu to capture attendees and the shared occasion.
5. Review birthdays, inactive contacts, and follow-ups on the home page. Export the migration bundle from Settings before moving plugin data.

## Data and migration

Person documents and structured profiles live in your SiYuan workspace. Uninstalling the plugin does not delete those documents. Each person's free-form note is stored in that person's document as well.

Interactions, follow-ups, reminder state, templates, and other plugin-owned data live in the plugin data directory and may be removed when the plugin or that directory is deleted. Export the plugin-data migration bundle from Settings before uninstalling. The bundle exports values and previews restore changes; **it is not a full SiYuan workspace backup or a byte-for-byte copy**. It does not include person documents, the native database or its binding anchors, interface preferences, or a separate copy of person notes. To move to another workspace, also migrate the documents and database through SiYuan's own workspace migration process.

## Current limitations

- Acceptance in real user workspaces, on Android devices, across real multiple windows, through the native graph entry point, and with external task managers is still pending. Isolated browser and mobile-viewport tests do not replace those checks.
- The English UI is not fully localized.
- vCard file import/export is supported; online CardDAV address-book and CalDAV calendar sync are not.
- The Bazaar PR is merged and the plugin is present in the catalog index; visibility in the client still needs an on-device check.

## Development

Requires Node.js 24+, pnpm 12.x, and SiYuan 3.8.5+. After installing dependencies, start SiYuan and run `pnpm make-link` to configure the development reload target, then run `pnpm dev`.

```bash
pnpm install
pnpm check          # TypeScript and Svelte checks
pnpm test           # Unit tests and architecture guards
pnpm test:ui        # Isolated desktop UI regression
pnpm test:ui:mobile # Isolated mobile viewport regression, not device acceptance
pnpm build          # Build dist/ and package.zip
pnpm check:release  # Release package gate
```

Before contributing, read the [development protocol](AGENTS.md), [handoff guide](docs/HANDOFF.md), and [data contract](docs/DATA-CONTRACT.md). See the [roadmap](docs/ROADMAP.md), [decisions](docs/DECISIONS.md), and [changelog](docs/CHANGELOG.md) for more context.

## Feedback and license

Report bugs or request features in [GitHub Issues](https://github.com/ai68298100/siyuan-contacts/issues). Include your SiYuan and plugin versions, reproduction steps, and redacted logs.

Licensed under the [MIT License](LICENSE).
