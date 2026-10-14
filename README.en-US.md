<div align="center">

# Lv Contacts (小驴人脉)

[![CI](https://github.com/ai68298100/siyuan-contacts/actions/workflows/ci.yml/badge.svg)](https://github.com/ai68298100/siyuan-contacts/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ai68298100/siyuan-contacts)](https://github.com/ai68298100/siyuan-contacts/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![SiYuan](https://img.shields.io/badge/SiYuan-%3E%3D%203.8.5-blue)

**Manage people and relationships in SiYuan: person records are documents backed by a native SiYuan database.**

**Latest stable release: v0.5.10** · [Download and install](https://github.com/ai68298100/siyuan-contacts/releases/tag/v0.5.10) · [Open an issue](https://github.com/ai68298100/siyuan-contacts/issues)

English | [简体中文](README.md)

<img src="preview.png" alt="Lv Contacts preview" width="640" />

</div>

---

Lv Contacts keeps people, relationships and shared experiences in your SiYuan workspace. Each person is a regular SiYuan document; structured profile fields live in a native database bound to that document, alongside SiYuan search, backlinks and sync.

## What's new in v0.5.10

This patch release resolves vertical text compression in the stale-contacts dashboard and streamlines form wording and option hierarchies across creation, editing, and organization workflows.

Fixed: stale contacts layout and text compression

- Eliminated vertical single-character text squeezing caused by unconfigured profile fields in narrow flex containers; compact profile summaries now enforce single-line layout and smooth truncation.
- Redesigned stale-contacts and upcoming-birthdays lists into modern two-tier card rows with 32px Squircle soft-gradient avatars mapped to five relationship groups.

Improved: creation, edit, and organization form options

- Upgraded primary save and creation buttons from text-only links to solid buttons with 1px top highlights and tactile micro-press feedback.
- Refined form hint copy, removing internal implementation jargon in favor of natural product descriptions.
- Reordered organization affiliation categories to match real-world frequency (Work, Education, Family, Other).

Validation: `pnpm check` (0 errors / 0 warnings), 594 unit tests (100% pass), desktop/mobile UI regression 378/378 each, and release gates pass.

## What's new in v0.5.9

This release delivers an extensive modern design overhaul, restoring visual depth, typography hierarchy, micro-interactions, and refined physical feel across both desktop and mobile viewports.

Added: modern design system and layered depth

- Introduced Ambient Occlusion multi-layer soft shadows and 1px inner rim highlights, resolving pale card washout and harsh dark wireframe aesthetics.
- Upgraded avatars, person details, wizard logos, and organization badges to smooth Squircle geometry with 135° dual-color gradients across five contact groups.
- Dashboard stats now feature a radial ambient glow and 28px tabular-nums typography.

Added: segmented sliding controls and frosted glass panels

- Rebuilt card/table view toggles as iOS/Linear-grade inset sliding tracks with active floating pill indicators and micro-haptic press feedback.
- Upgraded dialog backdrops with modern 10px frosted blur (`backdrop-filter: blur(10px)`) and a bold 22px / 700 header layout.
- Graph controls now float as a frosted capsule island (`blur(16px)`), complemented by a central radial light field.
- Organization cards feature 40px Squircle badge boxes and active member status breathing dots (Status Dot).

Improved: sidebar, table view, timeline and details

- Sidebar navigation items adopt modern floating pill selection and glowing brand iconography.
- Contacts table introduces sticky frosted headers (`backdrop-filter: blur(8px)`) and active row accent highlights.
- Person detail interaction history is restructured into a connected timeline track with stepped cards and dual-color exchange ledger badges.
- Upgraded settings navigation, tactile iOS 18-grade switches, 18px Squircle welcome wizard, 6px slim frosted scrollbars, and mobile bottom bar blur.

Validation: `pnpm check` (0 errors / 0 warnings), 594 unit tests (100% pass), desktop/mobile UI regression 378/378 each, and production release gates all pass.

## What's new in v0.5.8

This patch release fixes large imports, contact view switching and organization management, and adds batch organization membership actions.

Added: batch add contacts to an organization

- Select multiple contacts and register them in one organization. The selected scope is frozen, archived organizations are disabled, and empty states offer a create-organization route.
- Loading and saving lock duplicate actions, closing and scope changes.

Improved: batch feedback

- Partial failures show the affected contacts and readable errors; retry only sends failed contacts and never repeats successful writes.
- Successful writes refresh the roster and expose a clear result.

Fixed: large imports, view flicker and organization layout

- Attribute-view binding and document mapping use verified batches of 50, preventing 400+ imports from stopping after the first 50 contacts.
- Card/table switching keeps the local view intent, avoids skeleton flicker and restores detail focus after refresh.
- Organization member controls no longer collapse; desktop dialogs use a wider workspace while mobile remains full screen.

Validation: `pnpm check`, 594 unit tests, desktop/mobile UI regression 378/378 each, `pnpm build` and `pnpm check:release` pass.

## What's new in v0.5.7

### Design tokens and component consistency

- Added a three-layer Primitive → Semantic → Component token system for color, spacing, typography, radii, shadows, z-index, motion and control sizes. Light and dark themes now share the same semantic contract.
- Unified button, field, checkbox, radio, loading and focus-ring variants so new screens can reuse the same components.

### Measured consolidation

- Token coverage: 38.86% → 41.19%; color literals: 202 → 196; length literals: 2,057 → 1,936; non-4px-grid lengths: 1,159 → 1,071; font-size variants: 29 → 28.
- Reproduce the audit with pnpm audit:tokens; see [token consolidation report](docs/TOKEN-CONSOLIDATION-2026-10-14.md).

This release completes isolated-kernel and real browser-desktop acceptance, fixes the authentication cleanup boundary, and continues the contact and organization workflow refinements.

Added: isolated-kernel real frontend acceptance

- Added evidence for real browser-desktop dual-page, organization member/archive, birthday, ledger, alias, follow-up and cross-window flows.
- All writes, restart reads, migration checks and release artifacts use an isolated workspace.

Improved: E2E authentication and cleanup

- Injects the isolated kernel `api.token` before first-page and second-page navigation to avoid anonymous requests triggering the kernel failed-authentication limiter.
- Temporary notebooks are reliably cleaned after the real frontend run.

Fixed: E2E authentication race

- Fixed missing `Authorization` headers with kernels that store the token under `conf.api.token`.
- Fixed the second isolated page navigating before authentication headers were installed.

Added: contact creation prerequisites

- When relationship labels are entered, a new contact can create or select the self profile first. Failed prerequisites keep the current draft and do not leave a partial contact.

Improved: self profile editing and async states

- The self profile editor now exposes work and school organization choices, hides the inapplicable self relationship field, and keeps a stable loading state.
- Busy actions in import, batch operations and profile editing are disabled consistently to prevent duplicate submissions.

Fixed: related-person reads and self entry points

- Empty relation cells that omit `relation` or `blockIDs` are treated as empty; malformed non-empty relation data still stops writes for verification.
- Self markers are consistent across roster, search and detail entry points, so organization memberships can be edited from every route.

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

Manual installation from GitHub Releases is currently recommended. The Marketplace submission has been merged, but availability in the client has not been verified on a real device.

1. Download package.zip from the [v0.5.10 Release](https://github.com/ai68298100/siyuan-contacts/releases/tag/v0.5.10).
2. Extract its contents into data/plugins/siyuan-contacts/ in your SiYuan workspace. plugin.json must be at that directory root.
3. Restart SiYuan and enable **Lv Contacts** under **Settings → Marketplace → Installed**.

Requires **SiYuan 3.8.5 or later**.

## Data and privacy

Person documents, per-person notes and the contact database are SiYuan workspace content. The plugin sends no telemetry. AI recognition runs only after an explicit user action and sends the relevant note content to the AI service configured in SiYuan.

Plugin-managed data includes interactions, follow-ups, cadence and reminder state, adoption dates, templates, exchanges, aliases, self identity, organization memberships, organization profiles and relationship labels. It is stored in SiYuan's plugin data directory and may be lost when that data is deleted. Export the plugin data migration bundle from **Settings → Export Center** before uninstalling or deleting plugin data.

The migration bundle is a JSON value snapshot with a preview and merge flow, not a workspace or byte-for-byte backup. It covers those 12 plugin-data modules, but excludes person and organization documents, the contact database, database anchors, UI preferences and unfinished operation checkpoints. A per-person note lives in its person document and is not exported as a separate bundle entry. To move to another workspace, migrate the SiYuan documents and database first, rebind the database in the plugin, then import the bundle. The plugin does not guess document identity by matching names.

## Known limitations

- Isolated viewport and kernel tests do not establish acceptance in a real host. A real user workspace, Android device, keyboard/safe-area behavior and actual multi-window use have not been verified.
- Opening SiYuan's native graph, task-manager interoperability and Marketplace availability have not been verified; use the manual installation steps above.
- The in-app English translation is incomplete, so some interface text may appear in Chinese.
- CardDAV address-book sync and CalDAV calendar sync are not supported. Contacts can be exchanged using vCard files.

See the [v0.5.10 release notes](docs/RELEASE-NOTES-v0.5.10.md) for validation scope; previous release notes remain available for v0.5.9, v0.5.8, v0.5.7 and v0.5.6.

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
