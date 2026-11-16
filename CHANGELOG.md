# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-11-16

### Added

- `search` tool: find assignments, announcements and class materials by keyword across classes.
- `list_topics` tool, plus topic names on assignments and a `topicId` filter for `list_assignments`.
- `list_people` tool: teachers and classmates in a class.
- `get_assignment` now returns the grading rubric and the submission history, turn-in time and days late.
- MCP prompts: `plan_week`, `assignment_checklist`, `check_against_rubric`.
- MCP resources for classes and assignments under `songngan://`.
- `outputSchema` and `structuredContent` for read tools.
- Tests for auth, the token store, the submission writer, study features and the MCP server.
- ESLint and Prettier, run in CI.
- Contributing guide, security policy and issue templates.

### Changed

- Redesigned the sign-in result page, with light and dark themes.
- `setup` keeps the existing OAuth client when you press Enter.
- `turnedInAt` falls back to the submission update time, because Google does not send submission history to students.
- The `read` feature asks for two more read-only scopes: `classroom.topics.readonly` and `classroom.rosters.readonly`. Run `npm run setup` once after updating.

## [0.2.0] - 2026-11-16

### Changed

- SongNgan is installed from source and signs in with your own Google OAuth client; the shared built-in client was removed.
- All user-facing text and documentation is in English.

## [0.1.0]

### Added

- First version: classes, assignments, announcements, materials, grades, weekly digest, file and link reading, Drive upload, turn in and Calendar reminders.

[0.3.0]: https://github.com/fluki3-06s/songngan-mcp/releases/tag/v0.3.0
[0.2.0]: https://github.com/fluki3-06s/songngan-mcp/commits/main
