export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface Page<T> {
  items?: T[] | null;
  nextPageToken?: string | null;
}

const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'EPIPE']);

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as { status?: unknown; code?: unknown; response?: { status?: unknown } };
  for (const value of [candidate.response?.status, candidate.status, candidate.code]) {
    const status = typeof value === 'string' ? Number(value) : value;
    if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status < 600) return status;
  }
  return undefined;
}

export function isRetryable(error: unknown): boolean {
  const status = httpStatus(error);
  if (status !== undefined) return status === 408 || status === 429 || status >= 500;
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && RETRYABLE_CODES.has(code);
}

export async function withRetry<T>(task: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 4, baseDelayMs = 400, sleep: wait = sleep } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= retries || !isRetryable(error)) throw error;
      await wait(baseDelayMs * 2 ** attempt + Math.random() * baseDelayMs);
    }
  }
}

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index] as T, index);
    }
  });
  await Promise.all(lanes);
  return results;
}

export async function collectPages<T>(
  fetchPage: (pageToken?: string) => Promise<Page<T>>,
  max: number = Number.POSITIVE_INFINITY,
): Promise<T[]> {
  const collected: T[] = [];
  let token: string | undefined;
  do {
    const page = await fetchPage(token);
    collected.push(...(page.items ?? []));
    token = page.nextPageToken ?? undefined;
  } while (token && collected.length < max);
  return collected.slice(0, max);
}
