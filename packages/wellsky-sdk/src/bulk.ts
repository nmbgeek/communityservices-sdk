import { WellSkyError } from "./runtime.js";
import { ValidationError } from "./errors.js";

export type BulkItemResult<T> =
  | { index: number; outcome: "fulfilled"; value: T }
  | { index: number; outcome: "rejected"; error: WellSkyError }
  | { index: number; outcome: "skipped"; reason: "cancelled" | "callback_failed" };
export interface BulkReport<T> {
  results: BulkItemResult<T>[];
  callbackErrors: { index: number; error: WellSkyError }[];
}
export interface BulkOptions<T> {
  concurrency?: number;
  signal?: AbortSignal;
  /** Called as each item completes. Awaited before scheduling the next item on that worker. */
  onResult?: (result: BulkItemResult<T>) => void | Promise<void>;
}

/** No item is retried here. A rejected write promise does not prove the write was rolled back. */
export async function mapBulk<I, O>(items: readonly I[], worker: (item: I, context: { index: number; signal?: AbortSignal }) => Promise<O>, options: BulkOptions<O> = {}): Promise<BulkReport<O>> {
  const concurrency = options.concurrency ?? 8;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new ValidationError("bulk configuration", ["concurrency"]);
  const results: BulkItemResult<O>[] = [];
  const callbackErrors: BulkReport<O>["callbackErrors"] = [];
  let next = 0;
  let callbackFailed = false;
  const jobs = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length && !options.signal?.aborted && !callbackFailed) {
      const index = next++;
      // The index is reserved synchronously and is bounded by items.length.
      const item = items[index] as I;
      let result: BulkItemResult<O>;
      try { result = { index, outcome: "fulfilled", value: await worker(item, { index, ...(options.signal ? { signal: options.signal } : {}) }) }; }
      catch (error) { result = { index, outcome: "rejected", error: error instanceof WellSkyError ? error : new WellSkyError("protocol", "bulk item") }; }
      results[index] = result;
      try { await options.onResult?.(result); }
      catch {
        callbackFailed = true;
        callbackErrors.push({ index, error: new WellSkyError("protocol", "bulk result callback") });
      }
    }
  });
  await Promise.all(jobs);
  for (let index = next; index < items.length; index++) results[index] = { index, outcome: "skipped", reason: callbackFailed ? "callback_failed" : "cancelled" };
  return { results, callbackErrors };
}
