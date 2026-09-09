/**
 * Collects items for up to `intervalMs` (or until `maxBatchSize` is hit,
 * whichever comes first), then flushes them all to `handler` in one call.
 *
 * Used to batch AI-scoring requests: a burst of transactions in one poll
 * cycle gets scored in a single Gemini call instead of one call per
 * transaction, which is both faster (no per-item 60s stagger) and cheaper
 * against the API's requests-per-minute limit.
 *
 * In-memory only — if the process dies mid-buffer, unflushed items are
 * lost (unlike prove.ts's queue, there's no DB flag to sweep and resume
 * from). Acceptable for now; revisit if this needs to be durable.
 */
export class BatchQueue<T> {
  private buffer: T[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private intervalMs: number,
    private maxBatchSize: number,
    private handler: (items: T[]) => Promise<void>,
  ) {}

  enqueue(item: T): void {
    this.buffer.push(item);
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.intervalMs);
    }
    if (this.buffer.length >= this.maxBatchSize) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      void this.flush();
    }
  }

  /** Number of items currently buffered, waiting for the next flush. */
  get pending(): number {
    return this.buffer.length;
  }

  private async flush(): Promise<void> {
    this.timer = null;
    if (this.buffer.length === 0) return;
    const items = this.buffer;
    this.buffer = [];
    try {
      await this.handler(items);
    } catch (err) {
      console.error("[batchQueue] handler error:", err);
    }
  }
}