/**
 * Unit tests for CopyrightService.embedMetadata.
 *
 * This is the consumer side of the Copyright module's "Embed Metadata" button:
 * the service maps the module's IPTC/XMP model onto the writer's embeddable
 * { exif, xmp } payload and forwards it to the write-image-metadata IPC. The
 * IPC bridge is mocked here; we assert the mapping and the resolve/reject
 * contract (returns true on success, false on failure / unavailable bridge).
 */
import { CopyrightService, IPTCMetadata, XMPMetadata } from '../services/CopyrightService';
import { EmbeddableMetadata } from '../types/electron';

const service = CopyrightService.getInstance();

type WriteFn = (filePath: string, metadata: EmbeddableMetadata) => Promise<boolean>;
type AnyApi = { writeImageMetadata?: WriteFn };

function setApi(api: AnyApi | undefined): void {
  (window as unknown as { electronAPI?: AnyApi }).electronAPI = api;
}

afterEach(() => {
  setApi(undefined);
});

describe('CopyrightService.embedMetadata', () => {
  const iptc: IPTCMetadata = {
    copyrightNotice: '© 2026 Jane Doe',
    creator: 'Jane Doe',
    keywords: ['sky', 'sea']
  };
  const xmp: XMPMetadata = {};

  test('forwards the mapped payload to writeImageMetadata and returns true on resolve', async () => {
    const writeImageMetadata = jest.fn<Promise<boolean>, [string, EmbeddableMetadata]>(
      () => Promise.resolve(true)
    );
    setApi({ writeImageMetadata });

    const result = await service.embedMetadata('C:/pics/a.jpg', iptc, xmp);

    expect(result).toBe(true);
    expect(writeImageMetadata).toHaveBeenCalledTimes(1);
    const [calledPath, payload] = writeImageMetadata.mock.calls[0];
    expect(calledPath).toBe('C:/pics/a.jpg');
    // EXIF maps the universally-readable copyright/artist tags.
    expect(payload.exif?.Copyright).toBe('© 2026 Jane Doe');
    expect(payload.exif?.Artist).toBe('Jane Doe');
    // XMP carries rights + creator list + keywords as subjects.
    expect(payload.xmp?.rights).toBe('© 2026 Jane Doe');
    expect(payload.xmp?.creator).toEqual(['Jane Doe']);
    expect(payload.xmp?.subject).toEqual(['sky', 'sea']);
  });

  test('returns false when the bridge resolves false', async () => {
    setApi({ writeImageMetadata: jest.fn(() => Promise.resolve(false)) });
    const result = await service.embedMetadata('C:/pics/a.jpg', iptc, xmp);
    expect(result).toBe(false);
  });

  test('returns false (no throw) when the bridge rejects', async () => {
    setApi({ writeImageMetadata: jest.fn(() => Promise.reject(new Error('boom'))) });
    const result = await service.embedMetadata('C:/pics/a.jpg', iptc, xmp);
    expect(result).toBe(false);
  });

  test('returns false without calling the bridge when no embeddable fields are present', async () => {
    const writeImageMetadata = jest.fn(() => Promise.resolve(true));
    setApi({ writeImageMetadata });
    const result = await service.embedMetadata('C:/pics/a.jpg', {}, {});
    expect(result).toBe(false);
    expect(writeImageMetadata).not.toHaveBeenCalled();
  });

  test('returns false when the desktop bridge is unavailable', async () => {
    setApi(undefined);
    const result = await service.embedMetadata('C:/pics/a.jpg', iptc, xmp);
    expect(result).toBe(false);
  });
});
