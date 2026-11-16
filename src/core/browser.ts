import { spawn } from 'node:child_process';

export function openInBrowser(url: string): boolean {
  if (/^(1|true|yes)$/i.test(process.env.SONGNGAN_NO_BROWSER ?? '')) return false;
  const [command, args]: [string, string[]] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}
