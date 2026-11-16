import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { ClientSecret } from './client-secret.js';

export type Feature = 'read' | 'files' | 'write';

export const FEATURES: readonly Feature[] = ['read', 'files', 'write'];

const SCOPES: Readonly<Record<Feature, readonly string[]>> = {
  read: [
    'https://www.googleapis.com/auth/classroom.courses.readonly',
    'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
    'https://www.googleapis.com/auth/classroom.announcements.readonly',
    'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly',
  ],
  files: ['https://www.googleapis.com/auth/drive.readonly'],
  write: [
    'https://www.googleapis.com/auth/classroom.coursework.me',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/calendar.events',
  ],
};

interface Settings {
  features?: Feature[];
}

export class AppConfig {
  private constructor(
    readonly home: string,
    readonly clientSecretPath: string,
    readonly features: ReadonlySet<Feature>,
    readonly featuresFromEnv: boolean,
  ) {}

  static async load(env: NodeJS.ProcessEnv = process.env): Promise<AppConfig> {
    const home = resolve(env.SONGNGAN_HOME?.trim() || join(homedir(), '.song-ngan'));
    const settings = await AppConfig.readSettings(join(home, 'settings.json'));
    const fromEnv = AppConfig.featuresFromEnvironment(env);
    const features = new Set<Feature>(['read', ...(fromEnv ?? settings.features ?? [])]);
    const customSecret = env.SONGNGAN_CLIENT_SECRET?.trim();
    const clientSecretPath = resolve(customSecret && !customSecret.includes('${') ? customSecret : join(home, 'client_secret.json'));
    return new AppConfig(home, clientSecretPath, features, fromEnv !== undefined);
  }

  static isFeature(value: string): value is Feature {
    return (FEATURES as readonly string[]).includes(value);
  }

  get settingsPath(): string {
    return join(this.home, 'settings.json');
  }

  get tokenFallbackPath(): string {
    return join(this.home, 'token.json');
  }

  get scopes(): string[] {
    return [...new Set([...this.features].flatMap((feature) => SCOPES[feature]))];
  }

  has(feature: Feature): boolean {
    return this.features.has(feature);
  }

  async saveFeatures(features: Iterable<Feature>): Promise<void> {
    const unique = [...new Set(features)].filter((feature) => feature !== 'read');
    await mkdir(this.home, { recursive: true });
    await writeFile(this.settingsPath, `${JSON.stringify({ features: unique } satisfies Settings, null, 2)}\n`, 'utf8');
  }

  async importClientSecret(source: string): Promise<string> {
    const absolute = resolve(source);
    await ClientSecret.fromFile(absolute);
    await mkdir(this.home, { recursive: true });
    const target = join(this.home, 'client_secret.json');
    if (absolute !== target) await copyFile(absolute, target);
    return target;
  }

  private static async readSettings(path: string): Promise<Settings> {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as Settings;
      return { features: (parsed.features ?? []).filter((value) => AppConfig.isFeature(String(value))) };
    } catch {
      return {};
    }
  }

  private static featuresFromEnvironment(env: NodeJS.ProcessEnv): Feature[] | undefined {
    if (env.SONGNGAN_FEATURES !== undefined) {
      return env.SONGNGAN_FEATURES.split(',')
        .map((value) => value.trim())
        .filter((value): value is Feature => AppConfig.isFeature(value));
    }
    const files = AppConfig.flag(env.SONGNGAN_ENABLE_FILES);
    const write = AppConfig.flag(env.SONGNGAN_ENABLE_WRITE);
    if (files === undefined && write === undefined) return undefined;
    const features: Feature[] = [];
    if (files) features.push('files');
    if (write) features.push('write');
    return features;
  }

  private static flag(value: string | undefined): boolean | undefined {
    if (value === undefined || value.trim() === '' || value.includes('${')) return undefined;
    return /^(1|true|yes|on)$/i.test(value.trim());
  }
}
