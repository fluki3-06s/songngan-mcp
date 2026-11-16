import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Credentials } from 'google-auth-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthManager } from '../src/core/auth.js';
import { AppConfig } from '../src/core/config.js';
import { TokenStoreFactory, type TokenStore } from '../src/core/token-store.js';

const tempHome = () => mkdtemp(join(tmpdir(), 'song-ngan-'));

class MemoryStore implements TokenStore {
  readonly kind = 'memory';
  cleared = false;

  constructor(private credentials: Credentials | null = null) {}

  async load() {
    return this.credentials;
  }

  async save(credentials: Credentials) {
    this.credentials = credentials;
  }

  async clear() {
    this.credentials = null;
    this.cleared = true;
  }
}

describe('TokenStoreFactory file store', () => {
  const previous = process.env.SONGNGAN_TOKEN_STORE;

  beforeEach(() => {
    process.env.SONGNGAN_TOKEN_STORE = 'file';
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.SONGNGAN_TOKEN_STORE;
    else process.env.SONGNGAN_TOKEN_STORE = previous;
  });

  it('saves, loads and clears credentials', async () => {
    const path = join(await tempHome(), 'nested', 'token.json');
    const store = await TokenStoreFactory.create(path);
    expect(store.kind).toBe('file');
    expect(await store.load()).toBeNull();
    await store.save({ refresh_token: 'r', scope: 'a b' });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ refresh_token: 'r', scope: 'a b' });
    expect(await store.load()).toEqual({ refresh_token: 'r', scope: 'a b' });
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('treats a corrupt token file as signed out', async () => {
    const path = join(await tempHome(), 'token.json');
    await writeFile(path, 'not json');
    expect(await (await TokenStoreFactory.create(path)).load()).toBeNull();
  });

  it.skipIf(process.platform === 'win32')('writes the token file readable only by the owner', async () => {
    const path = join(await tempHome(), 'token.json');
    await (await TokenStoreFactory.create(path)).save({ refresh_token: 'r' });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
});

describe('AuthManager', () => {
  const config = async (features = '') => {
    const home = await tempHome();
    await writeFile(
      join(home, 'client_secret.json'),
      JSON.stringify({ installed: { client_id: 'id', client_secret: 'secret' } }),
    );
    return AppConfig.load({ SONGNGAN_HOME: home, SONGNGAN_FEATURES: features });
  };

  it('reports a missing client and no account', async () => {
    const empty = await AppConfig.load({ SONGNGAN_HOME: await tempHome() });
    const status = await new AuthManager(empty, new MemoryStore()).status();
    expect(status).toMatchObject({ client: 'missing', connected: false, storage: 'memory' });
    expect(status.missingScopes).toEqual(empty.scopes);
  });

  it('lists scopes the saved sign-in is missing', async () => {
    const settings = await config('files');
    const granted = settings.scopes.filter((scope) => !scope.includes('drive'));
    const status = await new AuthManager(settings, new MemoryStore({ refresh_token: 'r', scope: granted.join(' ') })).status();
    expect(status).toMatchObject({ client: 'custom', connected: true });
    expect(status.missingScopes).toEqual(['https://www.googleapis.com/auth/drive.readonly']);
  });

  it('builds a client from saved credentials without signing in', async () => {
    const auth = new AuthManager(await config(), new MemoryStore({ refresh_token: 'r', access_token: 'a' }));
    const client = await auth.getClient();
    expect(client.credentials.refresh_token).toBe('r');
    expect(await auth.getClient()).toBe(client);
  });

  it('clears the local token on logout even without a refresh token', async () => {
    const store = new MemoryStore({ access_token: 'a' });
    expect(await new AuthManager(await config(), store).logout()).toBe(false);
    expect(store.cleared).toBe(true);
  });
});
