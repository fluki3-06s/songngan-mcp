import { SongNganError } from '../errors.js';

export interface FetchedResource {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: Buffer;
}

const MAX_BYTES = 15 * 1024 * 1024;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 SongNgan';

export class WebFetcher {
  static async get(url: string, headers: Record<string, string> = {}, timeoutMs = 20_000): Promise<FetchedResource> {
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'th,en;q=0.8', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new SongNganError(`Could not open the link (${error instanceof Error ? error.message : String(error)}).`);
    }
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) throw new SongNganError(`The file at this link is too large to read (${Math.round(declared / 1e6)} MB).`);
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > MAX_BYTES) throw new SongNganError(`The file at this link is too large to read (${Math.round(body.length / 1e6)} MB).`);
    return {
      requestedUrl: url,
      finalUrl: response.url || url,
      status: response.status,
      contentType: (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '',
      body,
    };
  }

  static needsSignIn(resource: FetchedResource): boolean {
    return /accounts\.google\.com|\/ServiceLogin|\/signin\//i.test(resource.finalUrl);
  }
}
