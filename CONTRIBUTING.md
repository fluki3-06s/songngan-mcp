# Contributing

Thanks for helping improve SongNgan. Issues and pull requests are welcome.

## Setup

```bash
git clone https://github.com/fluki3-06s/songngan-mcp.git
cd songngan-mcp
npm install
```

To try changes against a real account, follow the [install steps](README.md#install) with your own OAuth client.

## Before you open a pull request

```bash
npm run check
npm run build
```

`npm run check` runs the type checker, ESLint, the Prettier check and the tests. CI runs the same steps on Linux, macOS and Windows with Node.js 20 and 22. Run `npm run format` to fix formatting.

## Code style

- TypeScript, strict mode, ES modules.
- Small classes with clear names; no comments, the code should explain itself.
- Google API calls live in `src/core/google/`; mapping to plain objects lives in `src/core/classroom-mapper.ts`; business logic lives in services such as `src/core/study.ts`.
- Every user-facing string is in English.

## Adding a tool

1. Add the Google call to the gateway in `src/core/google/` if needed.
2. Add the logic to a service and a mapper for the result.
3. Create a `Tool` subclass in `src/core/tools/`, with a clear description written for an AI reader and an `output` schema when the result is plain JSON.
4. Register it in `ToolRegistry.catalog()` and list it in `manifest.json` and the README.
5. If it needs a new Google scope, add it to the right feature in `src/core/config.ts` and note it in the changelog, because users must run `npm run setup` again.
6. Add tests with the fakes in `tests/fakes.ts`.

## Commits and releases

- Keep commits focused and write the subject in the imperative, e.g. "Add search tool".
- Update `CHANGELOG.md` under a new version heading.
- Releases are tagged `vX.Y.Z` on `main`.
