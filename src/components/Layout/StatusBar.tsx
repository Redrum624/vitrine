import { useAppStore } from '../../stores/appStore';
import { Segmented } from '../Controls/Segmented';
import { StarRating } from '../common/StarRating';
import type { ImageFileInfo } from '../../services/FileSystemService';
import { formatGalleryFooterLeft } from '../../utils/gallerySelection';
import { getDisplayFormat } from '../../utils/imageFormat';

interface StatusBarProps {
  currentImage?: {
    id: string;
    path: string;
    name: string;
    width?: number;
    height?: number;
    size?: number;
    type?: string;
  } | null;
  processingStats?: {
    processingTime: number;
    modulesActive: number;
    totalModules: number;
  };
  /** Gallery mode only (Task 7): the open folder's full image list, for the
   * left-side `path · N images · N RAW · total size` summary. */
  images?: ImageFileInfo[];
}

/** Rating-filter segmented control values: '0' = All, '1'-'5' = >= N stars. */
type RatingFilterValue = '0' | '1' | '2' | '3' | '4' | '5';

const RATING_FILTER_OPTIONS: { value: RatingFilterValue; label: string }[] = [
  { value: '0', label: 'All' },
  { value: '1', label: '≥1★' },
  { value: '2', label: '≥2★' },
  { value: '3', label: '≥3★' },
  { value: '4', label: '≥4★' },
  { value: '5', label: '≥5★' },
];

/** Footer stars use a darker gold than the shared default (`#facc15`) per the
 * Glass · Sectioned design tokens ("Stars `#eab308`"). */
const FOOTER_STAR_COLOR = '#eab308';

/**
 * Real half-width of the footer's center rating cluster (Segmented 6-way
 * "All … ≥5★" + `gap-3` + 5-star `StarRating` — its widest state, Develop with
 * a photo loaded), measured against the live app via a dev-mode Playwright
 * probe at 1920×1080: cluster width ≈ 383.9px → half ≈ 192px (see
 * task-8-report.md, "Fix round 1"). Padded to 195 + a 16px clearance so the
 * CSS-`calc()` bounds below can never let the left/right groups reach under
 * the cluster, at any supported window width (≥1024) in either view mode.
 *
 * A fixed constant (rather than a live JS/ResizeObserver measurement, as the
 * Toolbar pill's collapse/clamp uses) is safe and preferred here: the
 * cluster's *content* is a small, enumerable, developer-controlled set — not
 * user text — so its rendered width doesn't grow unboundedly the way a file
 * name or folder path can. The cluster's *position* (`clusterLeft` below) is
 * already known synchronously (the live axis, or 50%), so `calc()` alone can
 * derive the left/right groups' width budgets with no extra plumbing. The
 * unbounded part (the file name / folder path) is instead handled by CSS
 * ellipsis truncation inside that budget, not by trying to measure it.
 */
const CLUSTER_HALF_WIDTH = 195;
const CLUSTER_CLEARANCE = 16;
/** Matches the footer's own `px-4` (1rem/16px) horizontal padding: `left`/`right`
 * (the CSS properties) are resolved from the cluster's position which is
 * relative to the footer's OWN left edge (its border/padding box origin), but a
 * `max-width` on the left/right GROUP divs bounds a box whose own edge already
 * sits `FOOTER_PADDING_X` inside that origin (they're padded flex children, not
 * padded themselves) — so the padding has to be subtracted a second time or the
 * groups' far edge would land `FOOTER_PADDING_X` past the intended bound. */
const FOOTER_PADDING_X = 16;
const CLUSTER_EDGE_MARGIN = CLUSTER_HALF_WIDTH + CLUSTER_CLEARANCE + FOOTER_PADDING_X;

// Format file size
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

/** Splits the footer's left file-info into the variable-length `primary` label
 * (the file name — unbounded user content) and a fixed-shape `meta` tail
 * (`W × H · MP · FMT · size`), so the caller can let `primary` ellipsize first
 * while `meta` stays visible (narrow-width footer fix, see `CLUSTER_HALF_WIDTH`
 * below). */
export function formatStatusBarFileInfoParts(currentImage: StatusBarProps['currentImage']): { primary: string; meta: string } {
  if (!currentImage) return { primary: 'No image loaded', meta: '' };
  const { name, width, height, size } = currentImage;
  const metaParts: string[] = [];
  if (width && height) {
    metaParts.push(`${width} × ${height}`);
    metaParts.push(`${((width * height) / 1000000).toFixed(1)} MP`);
  }
  // Derived from the file name's extension (not the raw `type`, which can be a
  // MIME string like "image/jpeg" for folder-scanned images — see Task B2) so
  // the footer always shows a clean, camera/photo-app-familiar label ("JPG",
  // "ORF") regardless of which producer built this ImageFileInfo.
  const format = getDisplayFormat(name);
  if (format) metaParts.push(format);
  if (size) metaParts.push(formatFileSize(size));
  return { primary: name, meta: metaParts.join(' · ') };
}

/** Composes the footer's left file-info line: `name · W × H · MP · FMT · size`. */
export function formatStatusBarFileInfo(currentImage: StatusBarProps['currentImage']): string {
  const { primary, meta } = formatStatusBarFileInfoParts(currentImage);
  return meta ? `${primary} · ${meta}` : primary;
}

interface PerformanceWithMemory {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

// Get memory usage (if available)
const getMemoryInfo = (): string => {
  if ('memory' in performance) {
    const memory = (performance as PerformanceWithMemory).memory;
    if (memory) {
      const used = memory.usedJSHeapSize / 1024 / 1024;
      return `${used.toFixed(1)} MB`;
    }
  }
  return '';
};

export function StatusBar({ currentImage, processingStats, images }: StatusBarProps) {
  const imageRatings = useAppStore((s) => s.imageRatings);
  const setImageRating = useAppStore((s) => s.setImageRating);
  const ratingFilter = useAppStore((s) => s.ratingFilter);
  const setRatingFilter = useAppStore((s) => s.setRatingFilter);
  const viewMode = useAppStore((s) => s.viewMode);
  const alignmentAxisX = useAppStore((s) => s.alignmentAxisX);
  const selectedImageIds = useAppStore((s) => s.selectedImageIds);
  const developing = useAppStore((s) => s.developing);
  const memoryInfo = getMemoryInfo();
  const currentRating = currentImage ? (imageRatings[currentImage.id] ?? 0) : 0;
  const isGallery = viewMode === 'gallery';

  // Rider (Task 6 review): in Develop the cluster centers on the LIVE alignment
  // axis (falls back to window-center until first measured); in Gallery there is
  // no axis (no photo region), so it always centers on the window.
  const clusterLeft = isGallery ? '50%' : (alignmentAxisX ?? '50%');

  // Narrow-width footer fix (Fix round 1): bound the left/right groups' width so
  // neither can ever reach under the center cluster, at any width ≥1024. Derived
  // purely via CSS calc() from the cluster's own position (`clusterLeft`, a px
  // number or '50%') and its fixed half-width budget (`CLUSTER_EDGE_MARGIN`) — no
  // DOM measurement needed. Do NOT move the cluster itself; only these two
  // siblings are bounded.
  const clusterLeftCss = typeof clusterLeft === 'number' ? `${clusterLeft}px` : clusterLeft;
  const leftGroupMaxWidth = `calc(${clusterLeftCss} - ${CLUSTER_EDGE_MARGIN}px)`;
  const rightGroupMaxWidth = `calc(100% - ${clusterLeftCss} - ${CLUSTER_EDGE_MARGIN}px)`;
  const fileInfoParts = formatStatusBarFileInfoParts(currentImage);

  return (
    <div
      className="relative flex items-center justify-between px-4 text-xs no-select"
      style={{ height: '32px', borderTop: '1px solid var(--border)', backgroundColor: 'var(--gray-850)', color: 'var(--gray-400)' }}
    >
      {/* Left — file info (Develop) or folder summary (Gallery). `min-w-0` +
          `maxWidth`/`overflow:hidden` cap this group so it can shrink below its
          content width (the flexbox truncation prerequisite) instead of pushing
          into the cluster; the unbounded part (name/path) ellipsizes first. */}
      <div className="flex items-center min-w-0" style={{ maxWidth: leftGroupMaxWidth, overflow: 'hidden' }}>
        {isGallery ? (
          <span className="truncate" style={{ minWidth: 0 }}>{formatGalleryFooterLeft(images ?? [])}</span>
        ) : (
          <>
            {/* Name shrinks first (a hugely disproportionate flex-shrink factor —
                the standard flexbox "shrink me before my sibling" trick: the
                browser's shrink algorithm removes space proportional to
                basis×shrink-factor, freezing an item at its 0 minimum once its
                share is exhausted, THEN redistributes any remainder to the next
                unfrozen item — see task-8-report.md, "Fix round 1"). */}
            <span className="truncate" style={{ minWidth: 0, flexShrink: 9999 }}>{fileInfoParts.primary}</span>
            {fileInfoParts.meta && (
              // Meta only starts shrinking once the name has fully collapsed to
              // 0 (flexShrink:1, small relative to the name's 9999) — and when it
              // does, it ellipsizes too instead of being hard-clipped by the
              // container's overflow:hidden (which is a plain visual cut, not an
              // ellipsis).
              <span className="truncate" style={{ minWidth: 0, flexShrink: 1 }}>{` · ${fileInfoParts.meta}`}</span>
            )}
          </>
        )}
      </div>

      {/* Center — rating filter segmented + current photo's rating. Axis-centered
          in Develop, window-centered in Gallery (see clusterLeft above). */}
      <div className="absolute flex items-center gap-3" style={{ left: clusterLeft, top: '50%', transform: 'translate(-50%, -50%)' }}>
        <Segmented<RatingFilterValue>
          options={RATING_FILTER_OPTIONS}
          value={String(ratingFilter ?? 0) as RatingFilterValue}
          onChange={(v) => setRatingFilter(Number(v))}
        />
        {currentImage && (
          <StarRating
            size={13}
            color={FOOTER_STAR_COLOR}
            rating={currentRating}
            onRate={(r) => {
              setImageRating(currentImage.id, r);
              // Persist to the file (xmp:Rating) so it shows in OS file details.
              window.electronAPI?.writeImageRating?.(currentImage.path, r);
            }}
          />
        )}
      </div>

      {/* Right — Gallery: selected count (accent) then memory. Develop: processing
          stats (accent) then memory. Same width-budget guard as the left group. */}
      <div className="flex items-center space-x-3 min-w-0" style={{ maxWidth: rightGroupMaxWidth, overflow: 'hidden' }}>
        {isGallery ? (
          <span className="truncate" style={{ color: 'var(--accent)', minWidth: 0 }}>{selectedImageIds?.length ?? 0} selected</span>
        ) : (
          <>
            {/* Progressive open: while the fast embedded-JPEG preview is shown and the full
                16-bit decode runs in the background, surface a subtle "developing" chip. */}
            {developing && (
              <span className="truncate" style={{ color: 'var(--accent)', minWidth: 0, whiteSpace: 'nowrap' }}>
                Developing full quality…
              </span>
            )}
            {processingStats && (
              <span className="truncate" style={{ color: 'var(--accent)', minWidth: 0 }}>
                {processingStats.modulesActive}/{processingStats.totalModules} modules
                {processingStats.processingTime > 0 ? ` · ${processingStats.processingTime.toFixed(1)} ms` : ''}
              </span>
            )}
          </>
        )}
        {memoryInfo && <span style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{memoryInfo}</span>}
      </div>
    </div>
  );
}
