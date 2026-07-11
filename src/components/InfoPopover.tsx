import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { cameraMetadataService, type CameraInfo } from '../services/CameraMetadataService';
import type { ImageFileInfo } from '../services/FileSystemService';

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;
const WIDTH_ESTIMATE = 268;
const HEIGHT_ESTIMATE = 260;

interface InfoPopoverProps {
  image: ImageFileInfo;
  /** The filename chip the popover hangs beneath (top-left). */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

/**
 * Read-only "Info" popover anchored under the filename chip (Task Q6). Shows the
 * camera basics (make/model, lens, ISO, shutter, aperture, focal length, capture
 * date) plus the file's own name/dimensions/size. Camera EXIF comes from
 * CameraMetadataService, which sources RAW files from LibRaw's container (via the
 * read-raw-metadata IPC) and JPG/PNG/TIFF from exifreader — so it works for ALL
 * formats.
 *
 * Follows the Gallery/Toolbar popover idiom: a plain glass-chrome panel,
 * deliberately NOT aria-modal (global shortcuts stay live), dismissed on Escape
 * (capture phase) and outside-click. The anchor (the chip) is excluded from the
 * outside-click so its own toggle handler owns open/close without a double-fire.
 */
export function InfoPopover({ image, anchorRef, onClose }: InfoPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<CameraInfo | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: VIEWPORT_MARGIN, top: VIEWPORT_MARGIN });

  // Fetch camera EXIF for the current image (cached per-path in the service).
  useEffect(() => {
    let alive = true;
    setInfo(null);
    cameraMetadataService
      .getCameraInfo({ path: image.path })
      .then((ci) => {
        if (alive) setInfo(ci);
      })
      .catch(() => {
        if (alive) setInfo(null);
      });
    return () => {
      alive = false;
    };
  }, [image.path]);

  // Position directly beneath the anchor chip, clamped to the viewport. Re-runs
  // once the panel has a measured size (and whenever the fetched info changes its
  // height). In jsdom getBoundingClientRect returns zeros — harmless, it just
  // pins to the top-left margin.
  useLayoutEffect(() => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    const panel = panelRef.current;
    const w = panel?.offsetWidth || WIDTH_ESTIMATE;
    const h = panel?.offsetHeight || HEIGHT_ESTIMATE;
    const desiredLeft = anchor ? anchor.left : VIEWPORT_MARGIN;
    const desiredTop = anchor ? anchor.bottom + ANCHOR_GAP : VIEWPORT_MARGIN;
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - w - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - h - VIEWPORT_MARGIN);
    setPos({
      left: Math.min(Math.max(desiredLeft, VIEWPORT_MARGIN), maxLeft),
      top: Math.min(Math.max(desiredTop, VIEWPORT_MARGIN), maxTop),
    });
  }, [anchorRef, info]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const insidePanel = panelRef.current?.contains(target);
      const insideAnchor = anchorRef.current?.contains(target);
      if (!insidePanel && !insideAnchor) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Capture phase + stopImmediatePropagation: not aria-modal, so consume
        // Escape here before other bubble-phase listeners (mirrors the Gallery
        // context menu / Toolbar overflow popover).
        e.stopImmediatePropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose, anchorRef]);

  const camera = [info?.make, info?.model].filter(Boolean).join(' ').trim();
  const cameraRows: Array<[string, string]> = [];
  if (camera) cameraRows.push(['Camera', camera]);
  if (info?.lensModel) cameraRows.push(['Lens', info.lensModel]);
  if (info?.iso !== undefined) cameraRows.push(['ISO', String(info.iso)]);
  if (info?.shutter) cameraRows.push(['Shutter', info.shutter]);
  if (info?.aperture !== undefined) cameraRows.push(['Aperture', `f/${formatNum(info.aperture)}`]);
  if (info?.focalLength !== undefined) cameraRows.push(['Focal length', `${formatNum(info.focalLength)} mm`]);
  if (info?.dateTime) cameraRows.push(['Captured', formatExifDate(info.dateTime)]);

  const fileRows: Array<[string, string]> = [];
  if (image.dimensions) fileRows.push(['Dimensions', `${image.dimensions.width} × ${image.dimensions.height}`]);
  fileRows.push(['Size', formatBytes(image.size)]);
  fileRows.push(['Format', (image.format || '').toUpperCase()]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Image information"
      data-testid="info-popover"
      className="glass-chrome dc-rise"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        borderRadius: '12px',
        padding: '12px 14px',
        minWidth: '244px',
        maxWidth: '340px',
        zIndex: 60,
        fontSize: '12px',
        lineHeight: 1.5,
        color: 'var(--glass-text-chrome-primary)',
      }}
    >
      <div
        style={{
          fontWeight: 600,
          fontSize: '12.5px',
          marginBottom: '8px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          color: 'var(--glass-text-title)',
        }}
        title={image.name}
      >
        {image.name}
      </div>

      {cameraRows.length > 0 && <Section rows={cameraRows} />}
      {cameraRows.length === 0 && (
        <div style={{ color: 'var(--glass-text-muted)', marginBottom: '8px' }}>No camera metadata</div>
      )}
      <div style={{ height: '1px', background: 'var(--glass-border)', margin: '8px 0' }} />
      <Section rows={fileRows} />
    </div>
  );
}

const rowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '16px',
  padding: '1.5px 0',
};
const labelStyle: CSSProperties = { color: 'var(--glass-text-muted)', whiteSpace: 'nowrap' };
const valueStyle: CSSProperties = {
  color: 'var(--glass-text-chrome-primary)',
  textAlign: 'right',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

function Section({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div>
      {rows.map(([label, value]) => (
        <div key={label} style={rowStyle}>
          <span style={labelStyle}>{label}</span>
          <span style={valueStyle} title={value}>
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Trim a float to at most 1 decimal, dropping a trailing ".0" (1.8 -> "1.8", 17 -> "17"). */
function formatNum(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** EXIF colon date "YYYY:MM:DD HH:MM:SS" -> "YYYY-MM-DD HH:MM" for display. */
function formatExifDate(raw: string): string {
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
  return raw;
}

/** Human-readable byte size (e.g. 20.4 MB). */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${i === 0 ? n : n.toFixed(1)} ${units[i]}`;
}

export default InfoPopover;
