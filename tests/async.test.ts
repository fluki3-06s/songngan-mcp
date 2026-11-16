import { describe, expect, it } from 'vitest';
import { collectPages, httpStatus, isRetryable, mapLimit, withRetry } from '../src/core/async.js';

const noWait = async (): Promise<void> => undefined;

describe('httpStatus', () => {
  it('reads status from gaxios-style errors', () => {
    expect(httpStatus({ response: { status: 404 } })).toBe(404);
    expect(httpStatus({ code: '503' })).toBe(503);
    expect(httpStatus({ code: 'ECONNRESET' })).toBeUndefined();
    expect(httpStatus('boom')).toBeUndefined();
  });
});

describe('isRetryable', () => {
  it('retries rate limits, server errors and network resets only', () => {
    expect(isRetryable({ response: { status: 429 } })).toBe(true);
    expect(isRetryable({ response: { status: 502 } })).toBe(true);
    expect(isRetryable({ code: 'ECONNRESET' })).toBe(true);
    expect(isRetryable({ response: { status: 403 } })).toBe(false);
    expect(isRetryable(new Error('nope'))).toBe(false);
  });
});

describe('withRetry', () => {
  it('retries until the task succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw { response: { status: 503 } };
        return 'ok';
      },
      { sleep: noWait },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('gives up immediately on client errors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw { response: { status: 404 } };
        },
        { sleep: noWait },
      ),
    ).rejects.toEqual({ response: { status: 404 } });
    expect(calls).toBe(1);
  });

  it('stops after the retry budget', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw { response: { status: 500 } };
        },
        { retries: 2, sleep: noWait },
      ),
    ).rejects.toBeDefined();
    expect(calls).toBe(3);
  });
});

describe('mapLimit', () => {
  it('keeps order and never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const result = await mapLimit([5, 1, 4, 2, 3], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, value));
      active -= 1;
      return value * 10;
    });
    expect(result).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('handles empty input', async () => {
    expect(await mapLimit([], 3, async (value: number) => value)).toEqual([]);
  });
});

describe('collectPages', () => {
  it('follows page tokens and respects max', async () => {
    const pages: Record<string, { items: number[]; nextPageToken?: string }> = {
      start: { items: [1, 2], nextPageToken: 'b' },
      b: { items: [3, 4], nextPageToken: 'c' },
      c: { items: [5] },
    };
    expect(await collectPages(async (token) => pages[token ?? 'start'] ?? { items: [] })).toEqual([1, 2, 3, 4, 5]);
    expect(await collectPages(async (token) => pages[token ?? 'start'] ?? { items: [] }, 3)).toEqual([1, 2, 3]);
  });
});
