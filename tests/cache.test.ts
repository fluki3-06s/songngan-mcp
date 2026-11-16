import { describe, expect, it } from 'vitest';
import { TtlCache } from '../src/core/cache.js';

describe('TtlCache', () => {
  it('loads once while fresh and again after expiry', async () => {
    let now = 0;
    let loads = 0;
    const cache = new TtlCache(1_000, () => now);
    const loader = async () => ++loads;

    expect(await cache.getOrLoad('k', loader)).toBe(1);
    expect(await cache.getOrLoad('k', loader)).toBe(1);
    now = 1_500;
    expect(await cache.getOrLoad('k', loader)).toBe(2);
  });

  it('shares one in-flight request', async () => {
    let loads = 0;
    const cache = new TtlCache(1_000);
    const loader = async () => {
      loads += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return 'value';
    };
    await Promise.all([cache.getOrLoad('k', loader), cache.getOrLoad('k', loader)]);
    expect(loads).toBe(1);
  });

  it('forgets failed loads', async () => {
    const cache = new TtlCache(1_000);
    await expect(cache.getOrLoad('k', async () => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    await Promise.resolve();
    expect(await cache.getOrLoad('k', async () => 'ok')).toBe('ok');
  });

  it('invalidates by prefix', async () => {
    const cache = new TtlCache(1_000);
    await cache.getOrLoad('assignments:1', async () => 1);
    await cache.getOrLoad('assignments:2', async () => 2);
    await cache.getOrLoad('courses:false', async () => 3);
    cache.invalidate('assignments:');
    expect(cache.size).toBe(1);
  });
});
