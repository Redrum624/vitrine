/**
 * P6 item 7: EditPersistenceService.getSavedRawDecodeOptions must shape-validate the persisted
 * decode options. The store JSON is durable (survives app updates) so a value written by an
 * older/buggy build — or a tampered/partially-corrupt store — can carry a demosaic/highlightMode
 * outside the current enums. Such a value must NOT be propagated to the decoder / RawDecodePanel;
 * it falls back to DEFAULT_RAW_DECODE_OPTIONS. A genuinely absent value still returns null (the
 * caller supplies its own DEFAULT).
 */
import { editPersistenceService } from '../services/EditPersistenceService';
import { DEFAULT_RAW_DECODE_OPTIONS, RawDecodeOptions } from '../types/electron';

const storeGet = jest.fn();

beforeEach(() => {
  storeGet.mockReset();
  (window as unknown as { electronAPI: { storeGet: jest.Mock } }).electronAPI = { storeGet };
});

const withSaved = (rawDecodeOptions: unknown) =>
  storeGet.mockResolvedValue({ version: 1, modules: {}, rawDecodeOptions });

describe('getSavedRawDecodeOptions — persisted-shape validation', () => {
  it('returns valid persisted options unchanged', async () => {
    const valid: RawDecodeOptions = { demosaic: 'ahd', highlightMode: 'reconstruct' };
    withSaved(valid);
    expect(await editPersistenceService.getSavedRawDecodeOptions('/p.orf')).toEqual(valid);
  });

  it('falls back to DEFAULT when the demosaic is out of enum', async () => {
    withSaved({ demosaic: 'garbage', highlightMode: 'blend' });
    expect(await editPersistenceService.getSavedRawDecodeOptions('/p.orf')).toEqual(DEFAULT_RAW_DECODE_OPTIONS);
  });

  it('falls back to DEFAULT when the highlightMode is out of enum', async () => {
    withSaved({ demosaic: 'dcb', highlightMode: 'nuke-the-highlights' });
    expect(await editPersistenceService.getSavedRawDecodeOptions('/p.orf')).toEqual(DEFAULT_RAW_DECODE_OPTIONS);
  });

  it('falls back to DEFAULT for a structurally-corrupt (non-object) persisted value', async () => {
    withSaved('not-an-object');
    expect(await editPersistenceService.getSavedRawDecodeOptions('/p.orf')).toEqual(DEFAULT_RAW_DECODE_OPTIONS);
  });

  it('falls back to DEFAULT when a field is missing', async () => {
    withSaved({ demosaic: 'dcb' }); // no highlightMode
    expect(await editPersistenceService.getSavedRawDecodeOptions('/p.orf')).toEqual(DEFAULT_RAW_DECODE_OPTIONS);
  });

  it('returns null when nothing is persisted (caller supplies its own DEFAULT)', async () => {
    storeGet.mockResolvedValue({ version: 1, modules: {} }); // no rawDecodeOptions key
    expect(await editPersistenceService.getSavedRawDecodeOptions('/p.orf')).toBeNull();
  });

  it('returns null when there is no saved edit state at all', async () => {
    storeGet.mockResolvedValue(null);
    expect(await editPersistenceService.getSavedRawDecodeOptions('/p.orf')).toBeNull();
  });
});

/**
 * Q3 item 3: the Canvas open path already holds the edit state (single up-front getSavedEditState
 * read) and must run the SAME shape guard on savedState.rawDecodeOptions WITHOUT a second IPC read.
 * validateSavedRawDecodeOptions is that synchronous core — Canvas routes through it instead of
 * reading savedState.rawDecodeOptions raw (the P6-validator bypass this closes).
 */
describe('validateSavedRawDecodeOptions — synchronous Canvas-path guard', () => {
  it('returns valid options unchanged', () => {
    const valid: RawDecodeOptions = { demosaic: 'ahd', highlightMode: 'reconstruct' };
    expect(editPersistenceService.validateSavedRawDecodeOptions(valid)).toEqual(valid);
  });

  it('falls back to DEFAULT for an out-of-enum value', () => {
    expect(editPersistenceService.validateSavedRawDecodeOptions({ demosaic: 'garbage', highlightMode: 'blend' }))
      .toEqual(DEFAULT_RAW_DECODE_OPTIONS);
  });

  it('falls back to DEFAULT for a structurally-corrupt (non-object) value', () => {
    expect(editPersistenceService.validateSavedRawDecodeOptions('not-an-object')).toEqual(DEFAULT_RAW_DECODE_OPTIONS);
  });

  it('returns null for an absent (undefined/null) value so the caller supplies its own DEFAULT', () => {
    expect(editPersistenceService.validateSavedRawDecodeOptions(undefined)).toBeNull();
    expect(editPersistenceService.validateSavedRawDecodeOptions(null)).toBeNull();
  });
});
