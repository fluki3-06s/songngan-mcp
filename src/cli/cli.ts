import { ErrorFormatter } from '../core/errors.js';
import { VERSION } from '../version.js';
import {
  CallCommand,
  type Command,
  GUIDE_URL,
  LogoutCommand,
  ServeCommand,
  SetupCommand,
  StatusCommand,
  ToolsCommand,
} from './commands.js';
import { Terminal } from './terminal.js';

export class Cli {
  private readonly terminal = new Terminal();
  private readonly serve: Command;
  private readonly commands: readonly Command[];

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.serve = new ServeCommand(this.terminal, env);
    this.commands = [
      this.serve,
      new SetupCommand(this.terminal, env),
      new StatusCommand(this.terminal, env),
      new LogoutCommand(this.terminal, env),
      new ToolsCommand(this.terminal, env),
      new CallCommand(this.terminal, env),
    ];
  }

  async run(argv: readonly string[]): Promise<number> {
    const [name, ...args] = argv;
    if (name === undefined) return process.stdin.isTTY ? this.help() : this.execute(this.serve, []);
    if (['help', '-h', '--help'].includes(name)) return this.help();
    if (['version', '-v', '--version'].includes(name)) {
      this.terminal.print(VERSION);
      return 0;
    }
    const command = this.commands.find((item) => item.name === name);
    if (!command) {
      this.terminal.error(`Unknown command: ${name}`);
      this.help();
      return 1;
    }
    return this.execute(command, args);
  }

  private async execute(command: Command, args: string[]): Promise<number> {
    try {
      return await command.run(args);
    } catch (error) {
      this.terminal.error(ErrorFormatter.format(error));
      return 1;
    }
  }

  private help(): number {
    const width = Math.max(...this.commands.map((command) => command.usage.length));
    this.terminal.print(`SongNgan v${VERSION} — MCP server for Google Classroom\n`);
    this.terminal.print('Usage:');
    for (const command of this.commands) this.terminal.print(`  ${command.usage.padEnd(width)}  ${command.summary}`);
    this.terminal.print(`\nSetup guide: ${GUIDE_URL}`);
    return 0;
  }
}
