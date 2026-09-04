/** Workspace-local, non-persistent LRU. No timers, prefetch or Firebase listeners. */
export class LessonContentCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<T>>();
  private revision = 0;
  private mutations = 0;

  constructor(
    private readonly limit = 8,
    private readonly ttlMs = 60_000,
    private readonly now = Date.now,
  ) {}

  peek(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expiresAt <= this.now() || this.mutations > 0) return undefined;
    this.entries.set(key, entry);
    return entry.value;
  }

  load(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.peek(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const revision = this.revision;
    const request = loader().then((value) => {
      if (this.revision === revision && this.mutations === 0) {
        this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
        while (this.entries.size > this.limit) {
          this.entries.delete(this.entries.keys().next().value!);
        }
      }
      return value;
    });
    this.pending.set(key, request);
    void request.then(
      () => this.forgetPending(key, request),
      () => this.forgetPending(key, request),
    );
    return request;
  }

  private forgetPending(key: string, request: Promise<T>) {
    if (this.pending.get(key) === request) this.pending.delete(key);
  }

  clear() {
    this.revision++;
    this.entries.clear();
    this.pending.clear();
  }

  /** Reads overlapping writes must never become a fresh cached snapshot. */
  beginMutation(): () => void {
    this.mutations++;
    this.clear();
    return () => {
      this.mutations--;
      this.clear();
    };
  }
}
