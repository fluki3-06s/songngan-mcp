interface Entry {
  expiresAt: number;
  value: Promise<unknown>;
}

export class TtlCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ttlMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  getOrLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const now = this.clock();
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > now) return hit.value as Promise<T>;
    const value = loader();
    const entry: Entry = { expiresAt: now + this.ttlMs, value };
    this.entries.set(key, entry);
    value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return value;
  }

  invalidate(prefix = ''): void {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
