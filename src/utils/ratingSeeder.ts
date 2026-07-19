/**
 * Eager rating seeding — run once per folder load.
 *
 * The store's `imageRatings` starts empty each session; before this pass, the
 * ONLY thing that read a file's persisted xmp:Rating back was the lazy per-tile
 * seed inside loadThumbnail (gallery grid + filmstrip dock), which fires only
 * for MOUNTED tiles. Consequence: after a restart, a rated photo the user never
 * scrolled near was invisible to the rating filter — it simply didn't match.
 * This pass reads every file's rating on folder load (bounded concurrency; a
 * rating read is a cheap metadata/sidecar read, nothing like a thumbnail
 * decode), so filters see the whole folder. The lazy per-tile seeds stay as a
 * harmless backup — both paths dedupe and setImageRating is idempotent.
 */

import type { ImageFileInfo } from '../services/FileSystemService';

const SEED_CONCURRENCY = 8;

// Dedupe by PATH, not id — ids get reused across folders (see the
// clearImageDimensions comment in App.tsx). Bounded: cleared if it ever grows
// past a size no real browsing session reaches.
const seededPaths = new Set<string>();
const SEEDED_CAP = 50_000;

// Folder-switch cancellation: each pass gets a generation; workers stop pulling
// new files once a newer pass has started.
let generation = 0;

export async function seedImageRatings(
  images: ImageFileInfo[],
  read: (path: string) => Promise<number | null>,
  apply: (imageId: string, rating: number) => void,
): Promise<void> {
  const myGen = ++generation;
  if (seededPaths.size > SEEDED_CAP) seededPaths.clear();

  const pending = images.filter((img) => !seededPaths.has(img.path));

  let next = 0;
  const worker = async () => {
    while (generation === myGen) {
      // Mark a path as seeded only when its read is actually ISSUED — a pass
      // canceled by a folder switch leaves its remainder eligible for a later
      // pass (and concurrent passes can't double-read the same path).
      let img: ImageFileInfo | undefined;
      while (next < pending.length) {
        const candidate = pending[next++];
        if (!seededPaths.has(candidate.path)) { img = candidate; break; }
      }
      if (!img) return;
      seededPaths.add(img.path);
      try {
        const r = await read(img.path);
        if (typeof r === 'number' && r > 0) apply(img.id, r);
      } catch {
        // No rating / unreadable — leave unrated (same policy as the lazy seeds).
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(SEED_CONCURRENCY, pending.length) }, () => worker()),
  );
}
