/**
 * Task B2 — folder-scanned images carry a MIME-ish `type` ("image/jpeg") and a
 * raw-extension `format` ("JPEG", "tif") that read poorly once surfaced in the
 * UI (StatusBar footer showed "IMAGE/JPEG"; GalleryView tile meta showed
 * whatever casing/extension the producer happened to store). `getDisplayFormat`
 * is the single normalization point: any producer's `format`/`type` string, a
 * bare extension, or a filename/path all resolve to the same camera/photo-app
 * -familiar label (JPG, PNG, ORF, CR3, TIFF...).
 */
import { getDisplayFormat } from '../utils/imageFormat';

describe('getDisplayFormat', () => {
  it('maps jpg/jpeg to JPG regardless of case', () => {
    expect(getDisplayFormat('jpg')).toBe('JPG');
    expect(getDisplayFormat('JPG')).toBe('JPG');
    expect(getDisplayFormat('jpeg')).toBe('JPG');
    expect(getDisplayFormat('JPEG')).toBe('JPG');
  });

  it('maps tif/tiff to TIFF', () => {
    expect(getDisplayFormat('tif')).toBe('TIFF');
    expect(getDisplayFormat('tiff')).toBe('TIFF');
  });

  it('extracts the subtype from a MIME-ish string ("image/jpeg" -> JPG)', () => {
    expect(getDisplayFormat('image/jpeg')).toBe('JPG');
    expect(getDisplayFormat('image/png')).toBe('PNG');
    expect(getDisplayFormat('image/x-canon-cr3')).toBe('X-CANON-CR3');
  });

  it('extracts the extension from a filename or full path', () => {
    expect(getDisplayFormat('IMG_0001.jpg')).toBe('JPG');
    expect(getDisplayFormat('C:\\pics\\raw\\photo.ORF')).toBe('ORF');
    expect(getDisplayFormat('/p/vacation/beach.CR3')).toBe('CR3');
  });

  it('passes recognized RAW extensions through uppercased', () => {
    expect(getDisplayFormat('orf')).toBe('ORF');
    expect(getDisplayFormat('cr2')).toBe('CR2');
    expect(getDisplayFormat('cr3')).toBe('CR3');
    expect(getDisplayFormat('nef')).toBe('NEF');
    expect(getDisplayFormat('arw')).toBe('ARW');
    expect(getDisplayFormat('dng')).toBe('DNG');
    expect(getDisplayFormat('rw2')).toBe('RW2');
    expect(getDisplayFormat('raf')).toBe('RAF');
    expect(getDisplayFormat('pef')).toBe('PEF');
  });

  it('falls back to an uppercased echo for an unrecognized extension', () => {
    expect(getDisplayFormat('heic')).toBe('HEIC');
  });

  it('returns an empty string for empty/undefined/null input', () => {
    expect(getDisplayFormat('')).toBe('');
    expect(getDisplayFormat(undefined)).toBe('');
    expect(getDisplayFormat(null)).toBe('');
  });
});
