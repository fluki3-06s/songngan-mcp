# Installing SongNgan as an AI agent

Instructions for an AI coding agent installing this MCP server for a user. Follow the steps in order and verify each one before moving on.

## Rules

- Two steps can only be done by the user: creating the OAuth client in Google Cloud Console and approving Google sign-in in the browser. Explain them clearly and wait for the user. Never ask the user to paste the contents of `client_secret.json` or any token into the chat; ask for the file path only.
- Never commit, print or upload `client_secret.json`, `~/.song-ngan/token.json` or keychain entries.
- Do not enable the `write` feature unless the user asks for it.
- Use absolute paths in every MCP client config.

## 1. Check requirements

```bash
node --version
git --version
```

Node.js must be 20 or later. If it is missing or older, ask the user to install the LTS version from https://nodejs.org and stop until it is installed.

## 2. Get and build the code

If the repository is not cloned yet:

```bash
git clone https://github.com/fluki3-06s/songngan-mcp.git
cd songngan-mcp
```

Then, in the repository root:

```bash
npm install
```

`npm install` runs the build. Confirm `dist/index.js` exists and that `node dist/index.js --version` prints a version.

## 3. Get the user's OAuth client

Check whether a client is already configured:

```bash
node dist/index.js status
```

If `OAuth client` shows `custom (...)`, skip to step 4.

Otherwise, give the user these steps and wait until they have the downloaded JSON file:

1. Create a project: https://console.cloud.google.com/projectcreate
2. Enable each API with the project selected:
   - https://console.cloud.google.com/apis/library/classroom.googleapis.com
   - https://console.cloud.google.com/apis/library/drive.googleapis.com
   - https://console.cloud.google.com/apis/library/calendar-json.googleapis.com
3. At https://console.cloud.google.com/auth/overview choose Get started, set the app name to SongNgan, use their email and choose the External audience.
4. At https://console.cloud.google.com/auth/audience choose Publish app.
5. At https://console.cloud.google.com/auth/clients choose Create client, type Desktop app, then Download JSON.

Ask for the path of the downloaded file.

## 4. Connect the Google account

`setup` is interactive: it asks for the file path, asks about features and opens the browser. Run it in a terminal the user can see and type into, passing the file path:

```bash
npm run setup -- "/path/to/client_secret.json"
```

Tell the user to answer the feature questions, sign in with the Google account they use for Classroom, and choose Advanced > Go to SongNgan on the unverified app warning.

If you cannot run interactive commands, set the features through the environment instead and still let the user complete sign-in:

```bash
SONGNGAN_FEATURES=files node dist/index.js setup "/path/to/client_secret.json"
```

Verify:

```bash
node dist/index.js status
```

`Google account` must show an email, and there must be no `Missing permissions` line. Then run a real call:

```bash
node dist/index.js call list_courses "{}"
```

It must return the user's classes.

## 5. Register the server

Get the absolute path of `dist/index.js` in the repository. Add the server to the user's AI client:

```json
{
  "mcpServers": {
    "song-ngan": {
      "command": "node",
      "args": ["<absolute path>/dist/index.js", "serve"]
    }
  }
}
```

| Client | Config |
|---|---|
| Claude Code | `claude mcp add song-ngan -s user -- node "<absolute path>/dist/index.js" serve` |
| Claude Desktop | `claude_desktop_config.json`: `%APPDATA%\Claude\` on Windows, `~/Library/Application Support/Claude/` on macOS |
| Cursor | `~/.cursor/mcp.json` |
| VS Code | `.vscode/mcp.json`, with `"servers"` instead of `"mcpServers"` and `"type": "stdio"` |
| Gemini CLI | `~/.gemini/settings.json` |

Merge into existing config files instead of overwriting them. On Windows, use forward slashes in the path.

## 6. Finish

Ask the user to fully restart their AI client and ask "What's due this week?". If the tools do not appear, recheck the path in the config and run `node dist/index.js serve` once to see any startup error.

## Updating

```bash
git pull
npm install
```

Then restart the AI client. Settings and sign-in in `~/.song-ngan/` are kept.
