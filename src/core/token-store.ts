import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Credentials } from 'google-auth-library';

export interface TokenStore {
  readonly kind: string;
  load(): Promise<Credentials | null>;
  save(credentials: Credentials): Promise<void>;
  clear(): Promise<void>;
}

interface KeyringEntry {
  getPassword(): string | null | undefined;
  setPassword(value: string): void;
  deletePassword(): unknown;
}

interface KeyringModule {
  Entry: new (service: string, account: string) => KeyringEntry;
}

class KeyringTokenStore implements TokenStore {
  readonly kind = 'os-keychain';

  constructor(private readonly entry: KeyringEntry) {}

  async load(): Promise<Credentials | null> {
    const raw = this.entry.getPassword();
    return raw ? (JSON.parse(raw) as Credentials) : null;
  }

  async save(credentials: Credentials): Promise<void> {
    this.entry.setPassword(JSON.stringify(credentials));
  }

  async clear(): Promise<void> {
    try {
      this.entry.deletePassword();
    } catch {
      return;
    }
  }
}

class FileTokenStore implements TokenStore {
  readonly kind = 'file';

  constructor(private readonly path: string) {}

  async load(): Promise<Credentials | null> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as Credentials;
    } catch {
      return null;
    }
  }

  async save(credentials: Credentials): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(credentials), { encoding: 'utf8', mode: 0o600 });
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}

export class TokenStoreFactory {
  static readonly SERVICE = 'song-ngan';

  static async create(fallbackPath: string, account = 'google'): Promise<TokenStore> {
    if (process.env.SONGNGAN_TOKEN_STORE !== 'file') {
      const keyring = await TokenStoreFactory.keyring(account);
      if (keyring) return keyring;
    }
    return new FileTokenStore(fallbackPath);
  }

  private static async keyring(account: string): Promise<TokenStore | undefined> {
    const moduleName = '@napi-rs/keyring';
    try {
      const { Entry } = (await import(moduleName)) as KeyringModule;
      const entry = new Entry(TokenStoreFactory.SERVICE, account);
      entry.getPassword();
      return new KeyringTokenStore(entry);
    } catch {
      return undefined;
    }
  }
}
