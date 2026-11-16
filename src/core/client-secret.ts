import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { SongNganError } from './errors.js';

export type ClientSource = 'custom';

interface RawClient {
  client_id: string;
  client_secret: string;
}

export class ClientSecret {
  private constructor(
    readonly clientId: string,
    readonly clientSecret: string,
    readonly source: ClientSource,
  ) {}

  static async resolve(customPath: string): Promise<ClientSecret> {
    if (existsSync(customPath)) return ClientSecret.fromFile(customPath);
    throw new SongNganError(
      `Cannot find client_secret.json at ${customPath}.`,
      'Create a Desktop OAuth client in Google Cloud Console, then run `npm run setup` and choose its client_secret.json.',
    );
  }

  static parse(raw: string): ClientSecret {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new SongNganError('client_secret.json is not valid JSON.');
    }
    const client = ClientSecret.pick(data);
    if (!client) {
      throw new SongNganError(
        'client_secret.json does not contain a client_id and client_secret.',
        'Download an OAuth client of type "Desktop app" from Google Cloud Console > Google Auth Platform > Clients.',
      );
    }
    return new ClientSecret(client.client_id, client.client_secret, 'custom');
  }

  static async fromFile(path: string): Promise<ClientSecret> {
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      throw new SongNganError(
        `Cannot find client_secret.json at ${path}.`,
        'Run `npm run setup` and choose the client_secret.json you downloaded from Google Cloud Console.',
      );
    }
    return ClientSecret.parse(raw);
  }

  private static pick(data: unknown): RawClient | undefined {
    if (typeof data !== 'object' || data === null) return undefined;
    const root = data as Record<string, unknown>;
    for (const key of ['installed', 'web']) {
      const block = root[key];
      if (typeof block !== 'object' || block === null) continue;
      const { client_id, client_secret } = block as Record<string, unknown>;
      if (typeof client_id === 'string' && typeof client_secret === 'string') return { client_id, client_secret };
    }
    return undefined;
  }
}
