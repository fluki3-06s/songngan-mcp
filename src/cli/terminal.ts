import { stderr, stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

const YES = new Set(['y', 'yes', 'ok']);

export class Terminal {
  print(message = ''): void {
    stdout.write(`${message}\n`);
  }

  heading(message: string): void {
    this.print();
    this.print(`\x1b[1m${message}\x1b[0m`);
  }

  success(message: string): void {
    this.print(`\x1b[32m✔\x1b[0m ${message}`);
  }

  warn(message: string): void {
    stderr.write(`\x1b[33m!\x1b[0m ${message}\n`);
  }

  error(message: string): void {
    stderr.write(`\x1b[31m✖\x1b[0m ${message}\n`);
  }

  json(value: unknown): void {
    this.print(JSON.stringify(value, null, 2));
  }

  async ask(question: string): Promise<string> {
    const prompt = createInterface({ input: stdin, output: stdout });
    try {
      return (await prompt.question(`${question} `)).trim();
    } finally {
      prompt.close();
    }
  }

  async confirm(question: string, fallback: boolean): Promise<boolean> {
    const answer = (await this.ask(`${question} ${fallback ? '[Y/n]' : '[y/N]'}`)).toLowerCase();
    return answer === '' ? fallback : YES.has(answer);
  }
}
