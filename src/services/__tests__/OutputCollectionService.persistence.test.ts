/**
 * Persistence tests for OutputCollectionService + WebGalleryCollectionStore.
 *
 * Output collections and Web Gallery collections must survive an app restart by
 * persisting to localStorage (the established house convention). The trickiest
 * part is Date revival: OutputCollection stores live Date objects and sorts on
 * `.getTime()` (getCollections), so a string from JSON.parse would throw. These
 * tests pin the round-trip AND the Date revival, and verify gallery blobs are
 * stripped before save.
 */
import { OutputCollectionService } from '../OutputCollectionService';
import { webGalleryCollectionStore } from '../WebGalleryCollectionStore';
import { GalleryImage } from '../WebGalleryService';

const OUTPUT_KEY = 'photo_editor_output_collections';
const GALLERY_KEY = 'photo_editor_gallery_collections';

// Fresh service per test: the singleton getInstance caches one Map, so we build
// the class directly via its private constructor (matching the sibling export
// test's pattern) to isolate localStorage state across tests.
function makeService(): OutputCollectionService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (OutputCollectionService as any)();
}

beforeEach(() => {
  localStorage.clear();
});

describe('OutputCollectionService persistence', () => {
  test('createCollection + addImageToCollection writes to localStorage', () => {
    const service = makeService();
    const id = service.createCollection('My Clients', 'desc', 'client');
    service.addImageToCollection(id, 'C:/in/a.orf', 'a');

    const raw = localStorage.getItem(OUTPUT_KEY);
    expect(raw).not.toBeNull();

    const parsed = JSON.parse(raw as string);
    expect(parsed.version).toBe('1.0.0');
    expect(parsed.collections[0].name).toBe('My Clients');
    expect(parsed.collections[0].images[0].name).toBe('a');
  });

  test('survives a simulated restart with Date fields revived', () => {
    // First "session": create a collection and persist it.
    const first = makeService();
    const id = first.createCollection('Persisted', '', 'portfolio');
    first.addImageToCollection(id, 'C:/in/b.jpg', 'b');

    // Second "session": a brand-new instance reads from localStorage in its ctor.
    const second = makeService();
    const collections = second.getCollections();

    expect(collections).toHaveLength(1);
    expect(collections[0].name).toBe('Persisted');

    // Date revival guards the .getTime() sort in getCollections().
    expect(collections[0].modifiedDate instanceof Date).toBe(true);
    expect(collections[0].createdDate instanceof Date).toBe(true);
    expect(collections[0].images[0].addedDate instanceof Date).toBe(true);

    // The sort itself must not throw (proves getTime() works on revived dates).
    expect(() => second.getCollections()).not.toThrow();
  });

  test('revives nested export-history and client deadline dates', () => {
    const first = makeService();
    const id = first.createCollection('WithHistory', '', 'client');
    first.updateCollection(id, {
      clientInfo: { name: 'Acme', deadline: new Date('2025-02-06T00:00:00Z') }
    });
    // Push an export record through the public mutator path.
    const col = first.getCollection(id)!;
    col.exportHistory.push({
      id: 'export-1',
      date: new Date(),
      imageCount: 1,
      format: 'jpeg',
      destination: 'C:/out',
      totalSize: 123,
      duration: 5,
      success: true
    });
    // Re-save by touching a mutator (updateCollection persists current state).
    first.updateCollection(id, {});

    const second = makeService();
    const revived = second.getCollection(id)!;
    expect(revived.exportHistory[0].date instanceof Date).toBe(true);
    expect(revived.clientInfo?.deadline instanceof Date).toBe(true);
  });
});

describe('WebGalleryCollectionStore persistence', () => {
  test('round-trips a collection, stripping base64 blobs and reviving dates', () => {
    const image: GalleryImage = {
      id: 'img-1',
      originalPath: 'C:/in/c.jpg',
      title: 'Sunset',
      captureDate: new Date('2025-02-06T12:30:00Z'),
      camera: 'OM-1',
      keywords: ['sky', 'sea'],
      thumbnailData: 'data:image/png;base64,AAAA',
      previewData: 'data:image/png;base64,BBBB',
      fullSizeData: 'data:image/png;base64,CCCC'
    };

    webGalleryCollectionStore.saveCollections([
      { id: 'demo', name: 'Current Session', images: [image], createdAt: new Date() }
    ]);

    // Heavy base64 fields must not be persisted.
    const raw = localStorage.getItem(GALLERY_KEY) as string;
    expect(raw).not.toBeNull();
    expect(raw).not.toContain('previewData');
    expect(raw).not.toContain('fullSizeData');
    expect(raw).not.toContain('thumbnailData');

    const loaded = webGalleryCollectionStore.loadCollections();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('Current Session');
    expect(loaded[0].createdAt instanceof Date).toBe(true);

    const loadedImage = loaded[0].images[0];
    expect(loadedImage.title).toBe('Sunset');
    expect(loadedImage.keywords).toEqual(['sky', 'sea']);
    expect(loadedImage.captureDate instanceof Date).toBe(true);
    // Blobs are gone after the round-trip.
    expect(loadedImage.previewData).toBeUndefined();
    expect(loadedImage.fullSizeData).toBeUndefined();
    expect(loadedImage.thumbnailData).toBeUndefined();
  });

  test('returns an empty array when nothing is stored', () => {
    expect(webGalleryCollectionStore.loadCollections()).toEqual([]);
  });
});
