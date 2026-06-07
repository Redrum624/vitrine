/**
 * Unit tests for CopyrightService.extractMetadata.
 *
 * These cover the renderer-side mapping from exifreader's expanded tag shapes
 * (returned by the read-image-metadata IPC) onto the Copyright module's
 * IPTCMetadata + XMPMetadata model. The IPC itself is mocked here; only the
 * pure mapping logic is exercised.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CopyrightService } from '../services/CopyrightService';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildXmpPacket } = require('../../electron/imageWriter.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require('sharp');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ExifReader = require('exifreader');

const service = CopyrightService.getInstance();

type AnyApi = { readImageMetadata?: (p: string) => Promise<unknown> };

function setApi(api: AnyApi | undefined): void {
  (window as unknown as { electronAPI?: AnyApi }).electronAPI = api;
}

afterEach(() => {
  setApi(undefined);
});

describe('CopyrightService.extractMetadata', () => {
  test('maps a realistic IPTC + EXIF + XMP payload', async () => {
    const payload = {
      exif: {
        Copyright: { description: 'fallback' },
        Artist: { description: 'EXIF Artist' },
        DateTimeOriginal: { description: '2025:02:06 12:30:00' }
      },
      iptc: {
        'Copyright Notice': { description: '(c) 2025 Jane Doe' },
        'By-line': { description: 'Jane Doe' },
        'Object Name': { description: 'Sunset' },
        Keywords: [{ description: 'sky' }, { description: 'sea' }],
        City: { description: 'Nice' },
        'Date Created': { description: '2025-02-06' }
      },
      // exifreader (expanded) keys XMP tags by their BARE local name with the
      // original casing — dc:* -> {rights,creator,...}, xmpRights:* -> {UsageTerms,...}.
      // Lang-alt tags (rights/UsageTerms) expose the flattened string on .description;
      // list tags (creator) expose an array of child tags on .value.
      xmp: {
        rights: { value: [{ value: '(c) 2025' }], description: '(c) 2025' },
        creator: { value: [{ value: 'Jane Doe' }], description: 'Jane Doe' },
        UsageTerms: { value: [{ value: 'Contact for use' }], description: 'Contact for use' }
      },
      icc: {},
      thumbnail: null
    };

    setApi({ readImageMetadata: jest.fn().mockResolvedValue(payload) });

    const result = await service.extractMetadata('C:/pics/sunset.jpg');
    expect(result).not.toBeNull();
    const { iptc, xmp } = result!;

    // IPTC fields.
    expect(iptc.creator).toBe('Jane Doe');
    expect(iptc.title).toBe('Sunset');
    expect(iptc.keywords).toEqual(['sky', 'sea']);
    // IPTC copyright wins over the EXIF fallback.
    expect(iptc.copyrightNotice).toBe('(c) 2025 Jane Doe');
    expect(iptc.city).toBe('Nice');
    expect(iptc.dateCreated).toBeInstanceOf(Date);
    expect(iptc.dateCreated!.getFullYear()).toBe(2025);
    expect(iptc.copyrightStatus).toBe('copyrighted');
    // XMP cross-fill of the rights usage terms.
    expect(iptc.rightsUsageTerms).toBe('Contact for use');

    // XMP fields.
    expect(xmp.rights).toBe('(c) 2025');
    expect(xmp.creator).toEqual(['Jane Doe']);
    // dc:format absent -> path fallback.
    expect(xmp.format).toBe('image/jpeg');
  });

  test('falls back to EXIF when IPTC is empty', async () => {
    const payload = {
      exif: {
        Copyright: { description: '(c) EXIF Holder' },
        Artist: { description: 'EXIF Artist' },
        DateTimeOriginal: { description: '2025:02:06 12:30:00' }
      },
      iptc: {},
      xmp: {},
      icc: {},
      thumbnail: null
    };

    setApi({ readImageMetadata: jest.fn().mockResolvedValue(payload) });

    const result = await service.extractMetadata('C:/pics/raw.jpg');
    expect(result).not.toBeNull();
    const { iptc } = result!;

    expect(iptc.creator).toBe('EXIF Artist');
    expect(iptc.copyrightNotice).toBe('(c) EXIF Holder');
    expect(iptc.dateCreated).toBeInstanceOf(Date);
    expect(iptc.dateCreated!.getFullYear()).toBe(2025);
    expect(iptc.copyrightStatus).toBe('copyrighted');
  });

  test('normalizes a single repeatable IPTC tag (not an array) into a list', async () => {
    const payload = {
      exif: {},
      iptc: {
        Keywords: { description: 'lonely' },
        'By-line': { description: 'Solo Author' }
      },
      xmp: {},
      icc: {},
      thumbnail: null
    };

    setApi({ readImageMetadata: jest.fn().mockResolvedValue(payload) });

    const result = await service.extractMetadata('C:/pics/x.png');
    expect(result!.iptc.keywords).toEqual(['lonely']);
    expect(result!.iptc.creator).toBe('Solo Author');
    // Format derived from the .png path.
    expect(result!.xmp.format).toBe('image/png');
  });

  test('returns null when the IPC read rejects', async () => {
    setApi({ readImageMetadata: jest.fn().mockRejectedValue(new Error('boom')) });
    const result = await service.extractMetadata('C:/pics/broken.jpg');
    expect(result).toBeNull();
  });

  test('returns null when the readImageMetadata bridge is unavailable', async () => {
    setApi({});
    const result = await service.extractMetadata('C:/pics/x.jpg');
    expect(result).toBeNull();
  });

  // True write->read round-trip: build an XMP packet with the SAME writer the
  // export path uses (electron/imageWriter.cjs buildXmpPacket), embed it with
  // sharp.withXmp, write a real JPEG, then read it back through the exact
  // ExifReader.load(buf, { expanded: true }) call the read-image-metadata IPC
  // uses. This pins extractMetadata's mapping to exifreader's REAL key shape and
  // would catch any regression to the namespace-prefixed (dc:*/xmpRights:*) keys.
  test('recovers written rights/creator/subject via a real buildXmpPacket -> withXmp -> ExifReader round-trip', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copyright-xmp-roundtrip-'));
    const jpegPath = path.join(tmpDir, 'roundtrip.jpg');
    try {
      const writtenRights = '(c) 2025 Round Trip';
      const writtenCreator = ['Jane Doe', 'John Roe'];
      const writtenSubject = ['sky', 'sea'];
      const writtenUsageTerms = 'Contact for licensing';

      const packet = buildXmpPacket({
        title: 'Roundtrip Title',
        description: 'Roundtrip Description',
        rights: writtenRights,
        creator: writtenCreator,
        subject: writtenSubject,
        usageTerms: writtenUsageTerms
      });

      // Embed into a real JPEG exactly as applyMetadata does (withXmp only).
      const buf = await sharp({
        create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } }
      })
        .jpeg()
        .withXmp(packet)
        .toBuffer();
      fs.writeFileSync(jpegPath, buf);

      // Bridge stub mirrors the main-process read-image-metadata handler.
      setApi({
        readImageMetadata: jest.fn(async (p: string) => {
          const data = fs.readFileSync(p);
          const tags = ExifReader.load(data, { expanded: true });
          return {
            exif: tags.exif || {},
            iptc: tags.iptc || {},
            xmp: tags.xmp || {},
            icc: tags.icc || {},
            thumbnail: tags.Thumbnail || null
          };
        })
      });

      const result = await service.extractMetadata(jpegPath);
      expect(result).not.toBeNull();
      const { iptc, xmp } = result!;

      // The headline assertions: the written XMP values come back populated,
      // proving the short-key mapping matches exifreader's real output.
      expect(xmp.rights).toBe(writtenRights);
      expect(xmp.creator).toEqual(writtenCreator);
      expect(xmp.subject).toEqual(writtenSubject);
      expect(xmp.title).toBe('Roundtrip Title');
      expect(xmp.description).toBe('Roundtrip Description');
      // xmpRights:UsageTerms cross-fills the IPTC rights usage terms.
      expect(iptc.rightsUsageTerms).toBe(writtenUsageTerms);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
