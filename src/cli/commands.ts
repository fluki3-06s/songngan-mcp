import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { McpAdapter } from '../adapters/mcp.js';
import { SCHEMA_FORMATS, SchemaExporter } from '../adapters/schema.js';
import { Application } from '../application.js';
import { openInBrowser } from '../core/browser.js';
import { RichResult } from '../core/content.js';
import type { Feature } from '../core/config.js';
import { SongNganError } from '../core/errors.js';
import type { Terminal } from './terminal.js';

export const GUIDE_URL = 'https://github.com/fluki3-06s/songngan-mcp/#install';

export interface Command {
  readonly name: string;
  readonly usage: string;
  readonly summary: string;
  run(args: string[]): Promise<number>;
}

abstract class BaseCommand implements Command {
  abstract readonly name: string;
  abstract readonly usage: string;
  abstract readonly summary: string;

  constructor(
    protected readonly terminal: Terminal,
    protected readonly env: NodeJS.ProcessEnv,
  ) {}

  abstract run(args: string[]): Promise<number>;

  protected app(): Promise<Application> {
    return Application.create(this.env);
  }
}

export class ServeCommand extends BaseCommand {
  readonly name = 'serve';
  readonly usage = 'song-ngan serve';
  readonly summary = 'Start the MCP server on stdio (this is what AI apps run).';

  async run(): Promise<number> {
    await new McpAdapter(await this.app()).serve();
    return 0;
  }
}

export class SetupCommand extends BaseCommand {
  readonly name = 'setup';
  readonly usage = 'song-ngan setup [path/to/client_secret.json]';
  readonly summary = 'Connect your Google account step by step.';

  async run(args: string[]): Promise<number> {
    const t = this.terminal;
    t.heading('SongNgan setup');
    t.print(`Guide: ${GUIDE_URL}`);

    let app = await this.app();
    const existing = existsSync(app.config.clientSecretPath);
    const question = existing
      ? `\n1) Press Enter to keep ${app.config.clientSecretPath}, or drag a new client_secret.json here:`
      : '\n1) Path to client_secret.json (drag the file here):';
    const source = SetupCommand.cleanPath(args[0] ?? (await t.ask(question)));
    if (source) {
      t.success(`OAuth client saved to ${await app.config.importClientSecret(source)}`);
    } else if (existing) {
      t.success(`Using the OAuth client in ${app.config.clientSecretPath}`);
    } else {
      throw new SongNganError('No client_secret.json given.', `Create one first: ${GUIDE_URL}`);
    }

    if (app.config.featuresFromEnv) {
      t.warn('Features are set by environment variables (SONGNGAN_FEATURES / SONGNGAN_ENABLE_*), skipping questions.');
    } else {
      t.print('\n2) Choose what the AI may do:');
      const features: Feature[] = [];
      if (await t.confirm('   Read files attached to assignments (PDF, Docs, Slides)?', true)) features.push('files');
      if (await t.confirm('   Write actions: upload to Drive, attach, turn in, add to Calendar?', false)) features.push('write');
      await app.config.saveFeatures(features);
      app = await this.app();
    }

    t.print('\n3) Signing in with Google in your browser...');
    await app.auth.login((url) => {
      openInBrowser(url);
      t.print(`   If nothing opened, visit:\n   ${url}`);
    });
    t.success('Google account connected.');

    const courses = await (await app.services.study()).courses();
    t.success(`Found ${courses.length} active class(es).`);
    t.heading('Add SongNgan to your AI app:');
    t.print(ClientSnippets.render());
    return 0;
  }

  private static cleanPath(raw: string): string {
    return raw.trim().replace(/^["']+|["']+$/g, '');
  }
}

export class StatusCommand extends BaseCommand {
  readonly name = 'status';
  readonly usage = 'song-ngan status';
  readonly summary = 'Show sign-in state, enabled features and where data is stored.';

  async run(): Promise<number> {
    const app = await this.app();
    const status = await app.auth.status();
    const t = this.terminal;
    t.heading('SongNgan status');
    t.print(`Config folder   : ${app.config.home}`);
    t.print(`OAuth client    : ${status.client === 'custom' ? `custom (${app.config.clientSecretPath})` : status.client}`);
    t.print(`Features        : ${[...app.config.features].join(', ')}`);
    t.print(`Token storage   : ${status.storage}`);
    t.print(`Google account  : ${status.connected ? 'connected' : 'not connected'}`);
    t.print(
      `Tools           : ${app.registry
        .list()
        .map((tool) => tool.name)
        .join(', ')}`,
    );
    if (status.missingScopes.length > 0) {
      t.warn(`Missing permissions: ${status.missingScopes.map((scope) => scope.split('/').pop()).join(', ')}`);
      t.warn('Run `npm run setup` to grant them.');
      return 1;
    }
    return 0;
  }
}

export class LogoutCommand extends BaseCommand {
  readonly name = 'logout';
  readonly usage = 'song-ngan logout';
  readonly summary = 'Revoke access and delete the saved Google token from this computer.';

  async run(): Promise<number> {
    const app = await this.app();
    const revoked = await app.auth.logout();
    this.terminal.success(revoked ? 'Access revoked and token deleted.' : 'Token deleted from this computer.');
    return 0;
  }
}

export class ToolsCommand extends BaseCommand {
  readonly name = 'tools';
  readonly usage = `song-ngan tools [--format ${SCHEMA_FORMATS.join('|')}]`;
  readonly summary = 'Print tool definitions as JSON for any tool-calling AI.';

  async run(args: string[]): Promise<number> {
    const { values } = parseArgs({ args, options: { format: { type: 'string', short: 'f', default: 'openai' } } });
    const format = values.format ?? 'openai';
    if (!SchemaExporter.isFormat(format))
      throw new SongNganError(`Unknown format: ${format}.`, `Use one of: ${SCHEMA_FORMATS.join(', ')}`);
    this.terminal.json((await this.app()).toolSchemas(format));
    return 0;
  }
}

export class CallCommand extends BaseCommand {
  readonly name = 'call';
  readonly usage = 'song-ngan call <tool> [\'{"json":"input"}\']';
  readonly summary = 'Run one tool from the terminal, for testing.';

  async run(args: string[]): Promise<number> {
    const [name, raw] = args;
    if (!name) throw new SongNganError('Missing tool name.', `Usage: ${this.usage}`);
    let input: unknown = {};
    if (raw) {
      try {
        input = JSON.parse(raw);
      } catch {
        throw new SongNganError(
          'Tool input must be valid JSON.',
          `Example: song-ngan call list_assignments '{"status":["pending"]}'`,
        );
      }
    }
    const result = await (await this.app()).call(name, input);
    if (!(result instanceof RichResult)) {
      this.terminal.json(result);
      return 0;
    }
    this.terminal.json(result.data);
    if (result.images.length > 0) {
      const folder = resolve('song-ngan-output');
      await mkdir(folder, { recursive: true });
      for (const [index, image] of result.images.entries()) {
        const path = join(folder, `${name}-${Date.now()}-${index + 1}.${image.mimeType.split('/')[1] ?? 'bin'}`);
        await writeFile(path, Buffer.from(image.data, 'base64'));
        this.terminal.success(`Saved image: ${path}`);
      }
    }
    return 0;
  }
}

export class ClientSnippets {
  static render(): string {
    const entry = resolve(process.argv[1] ?? 'dist/index.js').replace(/\\/g, '/');
    const config = { mcpServers: { 'song-ngan': { command: 'node', args: [entry, 'serve'] } } };
    return [
      'Claude Desktop / Cursor / Windsurf / LM Studio (mcpServers JSON):',
      JSON.stringify(config, null, 2),
      '',
      'Claude Code:',
      `  claude mcp add song-ngan -s user -- node "${entry}" serve`,
      '',
      'Gemini CLI (~/.gemini/settings.json): same "mcpServers" block as above.',
      'VS Code: add to .vscode/mcp.json under "servers" with "type": "stdio".',
    ].join('\n');
  }
}
