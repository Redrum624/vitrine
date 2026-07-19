/**
 * Thumbnail scheduler — the shared priority queue behind gallery/dock thumbnail
 * fetches. Contract under test:
 *  - at most MAX_CONCURRENT run() calls are in flight at once (the rest queue)
 *  - a LATER request batch (e.g. the tiles a rating filter just revealed) is
 *    served BEFORE earlier still-queued requests (stale pre-filter tiles)
 *  - within one synchronous batch, order is FIFO (top of the viewport first)
 *  - re-scheduling / bumping a queued key promotes it to the newest batch
 *  - same key while queued/running dedupes to one run() and one shared promise
 *  - a rejected run() frees its slot and propagates to the caller
 */

type Sched = typeof import('../utils/thumbnailScheduler');

interface Deferred {
  promise: Promise<string | null>;
  resolve: (v: string | null) => void;
  reject: (e: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: (v: string | null) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<string | null>((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}

// Drain enough microtasks for .then chains + the scheduler's pump to settle.
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('thumbnailScheduler', () => {
  let sched: Sched;
  let started: string[];
  let deferreds: Map<string, Deferred>;

  const makeRun = (key: string) => () => {
    started.push(key);
    const d = deferred();
    deferreds.set(key, d);
    return d.promise;
  };

  beforeEach(() => {
    jest.resetModules();
    sched = require('../utils/thumbnailScheduler');
    started = [];
    deferreds = new Map();
  });

  test('caps concurrent run() calls at 4', async () => {
    for (let i = 1; i <= 10; i++) sched.scheduleThumbnail(`t${i}`, makeRun(`t${i}`));
    await tick();
    expect(started).toEqual(['t1', 't2', 't3', 't4']);
  });

  test('a later batch is served before earlier queued requests', async () => {
    // Batch 1: eight tiles mounted pre-filter; four start, four queue.
    for (let i = 1; i <= 8; i++) sched.scheduleThumbnail(`a${i}`, makeRun(`a${i}`));
    await tick();
    expect(started).toEqual(['a1', 'a2', 'a3', 'a4']);

    // Batch 2 (a later sync burst): the filtered tiles.
    sched.scheduleThumbnail('b1', makeRun('b1'));
    sched.scheduleThumbnail('b2', makeRun('b2'));

    deferreds.get('a1')!.resolve('data:1');
    await tick();
    expect(started[4]).toBe('b1'); // filtered tile beats queued a5..a8

    deferreds.get('a2')!.resolve('data:2');
    await tick();
    expect(started[5]).toBe('b2'); // FIFO within the newer batch

    deferreds.get('a3')!.resolve('data:3');
    await tick();
    expect(started[6]).toBe('a5'); // then the stale batch resumes in order
  });

  test('re-scheduling a queued key bumps it to the newest batch', async () => {
    for (let i = 1; i <= 8; i++) sched.scheduleThumbnail(`a${i}`, makeRun(`a${i}`));
    await tick();

    // a7 is re-requested later (e.g. scrolled back into view) — no new run(),
    // but it should now beat a5/a6.
    sched.scheduleThumbnail('a7', makeRun('dup-a7'));
    deferreds.get('a1')!.resolve('data:1');
    await tick();
    expect(started[4]).toBe('a7');
    expect(started).not.toContain('dup-a7');
  });

  test('bumpThumbnail promotes a queued key without a new run()', async () => {
    for (let i = 1; i <= 8; i++) sched.scheduleThumbnail(`a${i}`, makeRun(`a${i}`));
    await tick();

    sched.bumpThumbnail('a8');
    deferreds.get('a2')!.resolve('data:2');
    await tick();
    expect(started[4]).toBe('a8');
  });

  test('same key dedupes to one run() and one shared result', async () => {
    const p1 = sched.scheduleThumbnail('x', makeRun('x'));
    const p2 = sched.scheduleThumbnail('x', makeRun('x-again'));
    await tick();
    expect(started).toEqual(['x']);

    deferreds.get('x')!.resolve('data:x');
    await expect(p1).resolves.toBe('data:x');
    await expect(p2).resolves.toBe('data:x');
  });

  test('a completed key can be scheduled again (fresh run)', async () => {
    const p1 = sched.scheduleThumbnail('x', makeRun('x'));
    deferreds.get('x')!.resolve('data:x1');
    await expect(p1).resolves.toBe('data:x1');

    const p2 = sched.scheduleThumbnail('x', makeRun('x2'));
    await tick();
    expect(started).toEqual(['x', 'x2']);
    deferreds.get('x2')!.resolve('data:x2');
    await expect(p2).resolves.toBe('data:x2');
  });

  test('rejection propagates and frees the slot', async () => {
    const failing = sched.scheduleThumbnail('bad', makeRun('bad'));
    for (let i = 1; i <= 4; i++) sched.scheduleThumbnail(`t${i}`, makeRun(`t${i}`));
    await tick();
    expect(started).toEqual(['bad', 't1', 't2', 't3']);

    deferreds.get('bad')!.reject(new Error('decode failed'));
    await expect(failing).rejects.toThrow('decode failed');
    await tick();
    expect(started).toContain('t4'); // slot was released
  });
});
