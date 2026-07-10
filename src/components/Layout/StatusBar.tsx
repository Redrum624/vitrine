import { useAppStore } from '../../stores/appStore';
import { Segmented } from '../Controls/Segmented';
import { StarRating } from '../common/StarRating';
import type { ImageFileInfo } from '../../services/FileSystemService';
import { formatGalleryFooterLeft } from '../../utils/gallerySelection';

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

// Format file size
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

/** Composes the footer's left file-info line: `name · W × H · MP · FMT · size`. */
export function formatStatusBarFileInfo(currentImage: StatusBarProps['currentImage']): string {
  if (!currentImage) return 'No image loaded';
  const { name, width, height, type, size } = currentImage;
  const parts = [name];
  if (width && height) {
    parts.push(`${width} × ${height}`);
    parts.push(`${((width * height) / 1000000).toFixed(1)} MP`);
  }
  if (type) parts.push(type.toUpperCase());
  if (size) parts.push(formatFileSize(size));
  return parts.join(' · ');
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
  const { imageRatings, setImageRating, ratingFilter, setRatingFilter, viewMode, alignmentAxisX, selectedImageIds } = useAppStore();
  const memoryInfo = getMemoryInfo();
  const currentRating = currentImage ? (imageRatings[currentImage.id] ?? 0) : 0;
  const isGallery = viewMode === 'gallery';

  // Rider (Task 6 review): in Develop the cluster centers on the LIVE alignment
  // axis (falls back to window-center until first measured); in Gallery there is
  // no axis (no photo region), so it always centers on the window.
  const clusterLeft = isGallery ? '50%' : (alignmentAxisX ?? '50%');

  return (
    <div
      className="relative flex items-center justify-between px-4 text-xs no-select"
      style={{ height: '32px', borderTop: '1px solid var(--border)', backgroundColor: 'var(--gray-850)', color: 'var(--gray-400)' }}
    >
      {/* Left — file info (Develop) or folder summary (Gallery) */}
      <div className="flex items-center">
        <span>{isGallery ? formatGalleryFooterLeft(images ?? []) : formatStatusBarFileInfo(currentImage)}</span>
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
          stats (accent) then memory. */}
      <div className="flex items-center space-x-3">
        {isGallery ? (
          <span style={{ color: 'var(--accent)' }}>{selectedImageIds?.length ?? 0} selected</span>
        ) : (
          processingStats && (
            <span style={{ color: 'var(--accent)' }}>
              {processingStats.modulesActive}/{processingStats.totalModules} modules
              {processingStats.processingTime > 0 ? ` · ${processingStats.processingTime.toFixed(1)} ms` : ''}
            </span>
          )
        )}
        {memoryInfo && <span>{memoryInfo}</span>}
      </div>
    </div>
  );
}
