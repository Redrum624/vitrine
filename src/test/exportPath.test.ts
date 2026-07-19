import { exportService } from '../services/ExportService';

// generateOutputPath is private; exercise it directly (it's pure, no `this`).
const gen = (orig: string | undefined, opts: Record<string, unknown>): string =>
  (exportService as unknown as { generateOutputPath: (o: string | undefined, p: Record<string, unknown>) => string })
    .generateOutputPath(orig, opts);

describe('ExportService output path (Windows-safe)', () => {
  it('joins the output directory with ONLY the basename of a Windows source path', () => {
    const out = gen('C:\\Users\\Test\\Pictures\\2024\\PA200788.ORF', { outputDirectory: 'C:\\Users\\Test\\Desktop', format: 'jpeg' });
    expect(out).toBe('C:\\Users\\Test\\Desktop/PA200788_VIT.jpg');
  });

  it('does not double the path (regression: Desktop/C:\\...\\img.png)', () => {
    const out = gen('C:\\Users\\Test\\Pictures\\PA200788.ORF', { outputDirectory: 'C:\\Users\\Test\\Desktop', format: 'png' });
    expect(out).not.toContain('Desktop/C:');
    // exactly one drive-letter segment (the old bug produced two)
    const drives = out.split(/[/\\]/).filter((s) => /^[A-Za-z]:$/.test(s));
    expect(drives.length).toBe(1);
  });

  it('writes next to the original when no output directory is set', () => {
    const out = gen('C:\\Users\\Test\\Pictures\\PA200788.ORF', { format: 'tiff' });
    expect(out).toBe('C:\\Users\\Test\\Pictures/PA200788_VIT.tiff');
  });

  it('also handles forward-slash (POSIX) source paths', () => {
    const out = gen('/home/u/pics/img.cr2', { outputDirectory: '/tmp/out', format: 'jpeg' });
    expect(out).toBe('/tmp/out/img_VIT.jpg');
  });
});

describe('single-export non-clobber suffix increment', () => {
  const resolve = (p: string): Promise<string> =>
    (exportService as unknown as { resolveNonClobberingPath: (p: string) => Promise<string> })
      .resolveNonClobberingPath(p);

  const setExisting = (existing: string[]) => {
    (window as unknown as { electronAPI: { fileExists: (p: string) => Promise<boolean> } }).electronAPI = {
      fileExists: async (p: string) => existing.includes(p),
    };
  };

  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('returns the path unchanged when nothing exists', async () => {
    setExisting([]);
    await expect(resolve('C:/out/photo_VIT.jpg')).resolves.toBe('C:/out/photo_VIT.jpg');
  });

  it('bumps to _VIT_1 when the base name exists', async () => {
    setExisting(['C:/out/photo_VIT.jpg']);
    await expect(resolve('C:/out/photo_VIT.jpg')).resolves.toBe('C:/out/photo_VIT_1.jpg');
  });

  it('keeps incrementing past existing numbered exports', async () => {
    setExisting(['C:/out/photo_VIT.jpg', 'C:/out/photo_VIT_1.jpg', 'C:/out/photo_VIT_2.jpg']);
    await expect(resolve('C:/out/photo_VIT.jpg')).resolves.toBe('C:/out/photo_VIT_3.jpg');
  });

  it('fails open (unchanged path) when the existence check is unavailable', async () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    await expect(resolve('C:/out/photo_VIT.jpg')).resolves.toBe('C:/out/photo_VIT.jpg');
  });
});
