import { SongNganError } from '../errors.js';

export type LinkTarget =
  | { kind: 'drive'; fileId: string; url: string }
  | { kind: 'form'; url: string }
  | { kind: 'youtube'; url: string }
  | { kind: 'web'; url: string };

const DRIVE_HOSTS = new Set(['docs.google.com', 'drive.google.com']);

export class LinkResolver {
  static classify(raw: string): LinkTarget {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      throw new SongNganError(`Not a valid link: ${raw}`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new SongNganError('Only http and https links can be read.');
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'forms.gle' || (host === 'docs.google.com' && url.pathname.startsWith('/forms/'))) return { kind: 'form', url: url.href };
    if (DRIVE_HOSTS.has(host)) {
      const fileId = /\/d\/([A-Za-z0-9_-]{10,})/.exec(url.pathname)?.[1] ?? url.searchParams.get('id') ?? undefined;
      if (fileId) return { kind: 'drive', fileId, url: url.href };
    }
    if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) return { kind: 'youtube', url: url.href };
    return { kind: 'web', url: url.href };
  }
}
