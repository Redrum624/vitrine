import { editPersistenceService } from '../services/EditPersistenceService';

/**
 * Round-9 LOW-6: persisted bakeOrder entries were passed to setBakeOrder unvalidated. The store
 * JSON is durable across app updates, so an old/buggy build or a tampered store could carry
 * tokens outside the current enum. validateBakeOrder keeps only 'upscale' | 'deblur' (in order),
 * and returns undefined for a non-array / all-junk array so the caller falls back to the
 * marker-derived default order.
 */
describe('EditPersistenceService.validateBakeOrder (LOW-6)', () => {
  it('passes through valid tokens in order', () => {
    expect(editPersistenceService.validateBakeOrder(['upscale', 'deblur'])).toEqual(['upscale', 'deblur']);
    expect(editPersistenceService.validateBakeOrder(['deblur'])).toEqual(['deblur']);
  });

  it('filters out unknown tokens but keeps the valid ones', () => {
    expect(editPersistenceService.validateBakeOrder(['upscale', 'sharpen', 42, null])).toEqual(['upscale']);
  });

  it('returns undefined for a non-array or all-junk array', () => {
    expect(editPersistenceService.validateBakeOrder(undefined)).toBeUndefined();
    expect(editPersistenceService.validateBakeOrder('upscale')).toBeUndefined();
    expect(editPersistenceService.validateBakeOrder(['foo', 'bar'])).toBeUndefined();
    expect(editPersistenceService.validateBakeOrder([])).toBeUndefined();
  });
});
