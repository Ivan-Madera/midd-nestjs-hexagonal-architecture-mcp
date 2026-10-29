type Entry<V> = { value: V; expiresAt: number }

/**
 * Bounded in-memory cache: entries expire after `ttlMs` of INACTIVITY and the
 * store never grows past `maxEntries` (oldest entry is evicted first). It is the
 * anti-memory-leak storage for the per-IP counters of the rate limit guard.
 */
export class TtlCache<V> {
  private readonly store = new Map<string, Entry<V>>()

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number
  ) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key)
      return undefined
    }
    this.set(key, entry.value)
    return entry.value
  }

  set(key: string, value: V): void {
    this.store.delete(key)
    while (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value
      if (oldest === undefined) break
      this.store.delete(oldest)
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs })
  }

  get size(): number {
    return this.store.size
  }
}
