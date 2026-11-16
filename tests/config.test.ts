import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClientSecret } from '../src/core/client-secret.js';
import { AppConfig } from '../src/core/config.js';

const tempHome = () => mkdtemp(join(tmpdir(), 'song-ngan-'));

describe('AppConfig', () => {
  it('defaults to read-only features', async () => {
    const config = await AppConfig.load({ SONGNGAN_HOME: await tempHome() });
    expect([...config.features]).toEqual(['read']);
    expect(config.scopes.every((scope) => scope.includes('classroom'))).toBe(true);
  });

  it('persists features chosen in setup', async () => {
    const home = await tempHome();
    await (await AppConfig.load({ SONGNGAN_HOME: home })).saveFeatures(['files']);
    const reloaded = await AppConfig.load({ SONGNGAN_HOME: home });
    expect(reloaded.has('files')).toBe(true);
    expect(reloaded.has('write')).toBe(false);
  });

  it('lets environment variables override saved features', async () => {
    const config = await AppConfig.load({ SONGNGAN_HOME: await tempHome(), SONGNGAN_ENABLE_FILES: 'false', SONGNGAN_ENABLE_WRITE: 'true' });
    expect(config.featuresFromEnv).toBe(true);
    expect(config.has('write')).toBe(true);
    expect(config.has('files')).toBe(false);
    expect(config.scopes).toContain('https://www.googleapis.com/auth/calendar.events');
  });

  it('ignores unresolved extension placeholders', async () => {
    const config = await AppConfig.load({ SONGNGAN_HOME: await tempHome(), SONGNGAN_ENABLE_FILES: '${user_config.enable_files}' });
    expect(config.featuresFromEnv).toBe(false);
  });

  it('imports a valid client secret into the config folder', async () => {
    const home = await tempHome();
    const source = join(home, 'download.json');
    await writeFile(source, JSON.stringify({ installed: { client_id: 'id', client_secret: 'secret' } }));
    const config = await AppConfig.load({ SONGNGAN_HOME: home });
    expect(await config.importClientSecret(source)).toBe(join(home, 'client_secret.json'));
  });
});

describe('ClientSecret', () => {
  it('accepts desktop and web client files', () => {
    expect(ClientSecret.parse(JSON.stringify({ installed: { client_id: 'a', client_secret: 'b' } })).clientId).toBe('a');
    expect(ClientSecret.parse(JSON.stringify({ web: { client_id: 'c', client_secret: 'd' } })).clientSecret).toBe('d');
  });

  it('marks files as custom clients', () => {
    expect(ClientSecret.parse(JSON.stringify({ installed: { client_id: 'a', client_secret: 'b' } })).source).toBe('custom');
  });

  it('prefers a custom file and explains when no client is available', async () => {
    const home = await tempHome();
    const path = join(home, 'client_secret.json');
    await expect(ClientSecret.resolve(path)).rejects.toMatchObject({ hint: expect.stringMatching(/Desktop OAuth client/) });
    await writeFile(path, JSON.stringify({ installed: { client_id: 'mine', client_secret: 's' } }));
    expect((await ClientSecret.resolve(path)).clientId).toBe('mine');
  });

  it('treats unresolved extension placeholders as no custom client', async () => {
    const home = await tempHome();
    const config = await AppConfig.load({ SONGNGAN_HOME: home, SONGNGAN_CLIENT_SECRET: '${user_config.client_secret}' });
    expect(config.clientSecretPath).toBe(join(home, 'client_secret.json'));
  });

  it('rejects files without credentials', () => {
    expect(() => ClientSecret.parse('{}')).toThrow(/client_id/);
    expect(() => ClientSecret.parse('not json')).toThrow(/valid JSON/);
  });
});
