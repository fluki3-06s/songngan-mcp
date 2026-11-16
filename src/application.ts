import { SchemaExporter, type SchemaFormat } from './adapters/schema.js';
import { AuthManager } from './core/auth.js';
import { AppConfig } from './core/config.js';
import { ServiceContainer } from './core/container.js';
import { TokenStoreFactory } from './core/token-store.js';
import { ToolRegistry } from './core/tools/registry.js';

export class Application {
  private constructor(
    readonly config: AppConfig,
    readonly auth: AuthManager,
    readonly services: ServiceContainer,
    readonly registry: ToolRegistry,
  ) {}

  static async create(env: NodeJS.ProcessEnv = process.env): Promise<Application> {
    const config = await AppConfig.load(env);
    const store = await TokenStoreFactory.create(config.tokenFallbackPath);
    const auth = new AuthManager(config, store);
    return new Application(config, auth, new ServiceContainer(auth), new ToolRegistry(config.features));
  }

  call(name: string, input: unknown = {}): Promise<unknown> {
    return this.registry.require(name).run(input, this.services);
  }

  toolSchemas(format: SchemaFormat = 'openai'): unknown[] {
    return new SchemaExporter(this.registry.list()).export(format);
  }
}
