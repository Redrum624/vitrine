/**
 * Shared priority queue for thumbnail fetches (gallery grid + filmstrip dock).
 *
 * Both views fire a readImageAsDataURL IPC per mounted tile. Unthrottled, a big
 * folder floods the main process, and — worse — requests complete in arrival
 * order: when a rating filter reveals tiles that weren't mounted before, their
 * fetches queue BEHIND decodes for photos the filter just hid, so the tiles the
 * user asked to see render last. This queue fixes both:
 *  - at most MAX_CONCURRENT fetches in flight (main process never floods)
 *  - the newest request batch is served first (a batch = one synchronous burst,
 *    i.e. one render pass's worth of visible tiles), FIFO within the batch —
 *    so a filter/scroll change jumps ahead of stale queued work
 *  - keys dedupe: queued/running keys share one promise; re-requesting (or
 *    bumpThumbnail) promotes a queued key to the newest batch
 */

type Result = string | null;

interface Job {
  key: string;
  run: () => Promise<Result>;
  gen: number;
  seq: number;
  promise: Promise<Result>;
  resolve: (v: Result) => void;
  reject: (e: unknown) => void;
  running: boolean;
}

const MAX_CONCURRENT = 4;

// Queued + running jobs by key (dedupe); `queue` holds only not-yet-started jobs.
const jobs = new Map<string, Job>();
const queue: Job[] = [];
let running = 0;

// Batch bookkeeping: all schedule/bump calls within one synchronous burst share
// a generation; the microtask closes the burst so the next render pass gets a
// fresh (higher-priority) one.
let gen = 0;
let genOpen = false;
let seqCounter = 0;

function currentGen(): number {
  if (!genOpen) {
    gen++;
    genOpen = true;
    queueMicrotask(() => { genOpen = false; });
  }
  return gen;
}

function pickNext(): Job | undefined {
  if (queue.length === 0) return undefined;
  let best = 0;
  for (let i = 1; i < queue.length; i++) {
    const a = queue[i];
    const b = queue[best];
    if (a.gen > b.gen || (a.gen === b.gen && a.seq < b.seq)) best = i;
  }
  return queue.splice(best, 1)[0];
}

function pump(): void {
  while (running < MAX_CONCURRENT) {
    const job = pickNext();
    if (!job) return;
    job.running = true;
    running++;
    job.run().then(
      (v) => { finish(job); job.resolve(v ?? null); },
      (e) => { finish(job); job.reject(e); },
    );
  }
}

function finish(job: Job): void {
  jobs.delete(job.key);
  running--;
  pump();
}

/**
 * Enqueue a thumbnail fetch. If the key is already queued, it's promoted to the
 * newest batch and the existing promise is returned (run is NOT called again);
 * if it's already running, the in-flight promise is returned as-is.
 */
export function scheduleThumbnail(key: string, run: () => Promise<Result>): Promise<Result> {
  const existing = jobs.get(key);
  if (existing) {
    if (!existing.running) {
      existing.gen = currentGen();
      existing.seq = ++seqCounter;
    }
    return existing.promise;
  }

  let resolve!: (v: Result) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<Result>((r, j) => { resolve = r; reject = j; });
  const job: Job = {
    key, run, gen: currentGen(), seq: ++seqCounter, promise, resolve, reject, running: false,
  };
  jobs.set(key, job);
  queue.push(job);
  pump();
  return promise;
}

/** Promote a queued key to the newest batch without touching its fetch. */
export function bumpThumbnail(key: string): void {
  const job = jobs.get(key);
  if (job && !job.running) {
    job.gen = currentGen();
    job.seq = ++seqCounter;
  }
}
