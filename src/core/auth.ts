import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { CodeChallengeMethod, OAuth2Client, type Credentials } from 'google-auth-library';
import { openInBrowser } from './browser.js';
import { ClientSecret, type ClientSource } from './client-secret.js';
import type { AppConfig } from './config.js';
import { AuthRequiredError, ErrorFormatter, SongNganError } from './errors.js';
import { ResultPage } from './result-page.js';
import type { TokenStore } from './token-store.js';

export interface AuthStatus {
  client: ClientSource | 'missing';
  connected: boolean;
  storage: string;
  grantedScopes: string[];
  missingScopes: string[];
}

interface LoginSession {
  url: string;
  done: Promise<Credentials>;
}

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export class AuthManager {
  private client?: OAuth2Client;
  private pending?: LoginSession;
  private lastError?: string;

  constructor(
    private readonly config: AppConfig,
    private readonly store: TokenStore,
  ) {}

  async getClient(): Promise<OAuth2Client> {
    if (this.client) return this.client;
    const credentials = await this.store.load();
    if (!credentials?.refresh_token) {
      throw new AuthRequiredError(await this.beginBackgroundLogin(), this.lastError);
    }
    this.client = await this.createClient(credentials);
    return this.client;
  }

  async login(onUrl: (url: string) => void): Promise<Credentials> {
    const session = await this.startLogin();
    onUrl(session.url);
    return session.done;
  }

  async status(): Promise<AuthStatus> {
    const credentials = await this.store.load();
    const client = await ClientSecret.resolve(this.config.clientSecretPath).catch(() => undefined);
    return {
      client: client?.source ?? 'missing',
      connected: Boolean(credentials?.refresh_token),
      storage: this.store.kind,
      grantedScopes: AuthManager.scopesOf(credentials),
      missingScopes: this.missingScopes(credentials),
    };
  }

  async logout(): Promise<boolean> {
    const credentials = await this.store.load();
    let revoked = false;
    if (credentials?.refresh_token) {
      try {
        await new OAuth2Client().revokeToken(credentials.refresh_token);
        revoked = true;
      } catch {
        revoked = false;
      }
    }
    await this.store.clear();
    this.client = undefined;
    return revoked;
  }

  private missingScopes(credentials: Credentials | null | undefined): string[] {
    const granted = new Set(AuthManager.scopesOf(credentials));
    return this.config.scopes.filter((scope) => !granted.has(scope));
  }

  private async beginBackgroundLogin(): Promise<string> {
    const session = this.pending ?? (await this.startLogin());
    if (session !== this.pending) {
      this.pending = session;
      openInBrowser(session.url);
      session.done
        .then(() => {
          this.lastError = undefined;
        })
        .catch((error: unknown) => {
          this.lastError = `Last sign-in failed: ${ErrorFormatter.format(error)}`;
          process.stderr.write(`[song-ngan] ${this.lastError}\n`);
        })
        .finally(() => {
          if (this.pending === session) this.pending = undefined;
        });
    }
    return session.url;
  }

  private async startLogin(): Promise<LoginSession> {
    const secret = await ClientSecret.resolve(this.config.clientSecretPath);
    const { server, port } = await AuthManager.listen();
    const oauth = new OAuth2Client({
      clientId: secret.clientId,
      clientSecret: secret.clientSecret,
      redirectUri: `http://127.0.0.1:${port}/callback`,
    });
    const { codeVerifier, codeChallenge } = await oauth.generateCodeVerifierAsync();
    const state = randomUUID();
    const url = oauth.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: this.config.scopes,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });
    const done = AuthManager.receiveCallback(server, state, async (code) => {
      const { tokens } = await oauth.getToken({ code, codeVerifier });
      if (!tokens.refresh_token) {
        throw new SongNganError(
          'Google did not return a refresh token.',
          'Remove SongNgan at https://myaccount.google.com/connections and sign in again.',
        );
      }
      const stored: Credentials = {
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token,
        expiry_date: tokens.expiry_date,
        token_type: tokens.token_type,
        scope: tokens.scope,
      };
      await this.store.save(stored);
      this.client = undefined;
      this.lastError = undefined;
      return stored;
    });
    return { url, done };
  }

  private async createClient(credentials: Credentials): Promise<OAuth2Client> {
    const secret = await ClientSecret.resolve(this.config.clientSecretPath);
    const client = new OAuth2Client({ clientId: secret.clientId, clientSecret: secret.clientSecret });
    client.setCredentials(credentials);
    let current = credentials;
    client.on('tokens', (tokens: Credentials) => {
      current = { ...current, ...tokens, refresh_token: tokens.refresh_token ?? current.refresh_token };
      this.store.save(current).catch(() => undefined);
    });
    return client;
  }

  private static scopesOf(credentials: Credentials | null | undefined): string[] {
    return (credentials?.scope ?? '').split(/\s+/).filter(Boolean);
  }

  private static listen(): Promise<{ server: Server; port: number }> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address === 'object') resolve({ server, port: address.port });
        else reject(new SongNganError('Could not open a local port for Google sign-in.'));
      });
    });
  }

  private static receiveCallback(
    server: Server,
    state: string,
    exchange: (code: string) => Promise<Credentials>,
  ): Promise<Credentials> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const close = (): void => {
        clearTimeout(timer);
        server.close();
        setImmediate(() => server.closeAllConnections());
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        close();
        reject(new SongNganError('Google sign-in timed out after 5 minutes.', 'Start the sign-in again to get a new link.'));
      }, LOGIN_TIMEOUT_MS);
      server.on('request', (request: IncomingMessage, response: ServerResponse) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/callback') {
          response.writeHead(404).end();
          return;
        }
        const reply = (success: boolean, detail?: string): void => {
          response
            .writeHead(success ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
            .end(AuthManager.resultPage(success, detail));
        };
        if (settled) {
          reply(false, 'This sign-in link was already used. Ask your AI again for a new one.');
          return;
        }
        settled = true;
        const code = url.searchParams.get('code');
        const work =
          code !== null && url.searchParams.get('state') === state
            ? exchange(code)
            : Promise.reject(
                new SongNganError(`Google sign-in was not completed (${url.searchParams.get('error') ?? 'invalid response'}).`),
              );
        work
          .then(
            (tokens) => {
              reply(true);
              resolve(tokens);
            },
            (error: unknown) => {
              reply(false, ErrorFormatter.format(error));
              reject(error);
            },
          )
          .finally(close);
      });
    });
  }

  private static resultPage(success: boolean, detail?: string): string {
    return ResultPage.render(success, detail);
  }
}
