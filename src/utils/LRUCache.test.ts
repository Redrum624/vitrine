import { LRUCache } from './LRUCache';

describe('LRUCache', () => {
  describe('basic operations', () => {
    it('should store and retrieve values', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBe('value2');
    });

    it('should return undefined for non-existent keys', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });

      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should correctly report if key exists', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });

      cache.set('key1', 'value1');

      expect(cache.has('key1')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('should delete entries', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });

      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);

      cache.delete('key1');
      expect(cache.has('key1')).toBe(false);
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should clear all entries', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      cache.clear();

      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(false);
      expect(cache.has('key3')).toBe(false);
      expect(cache.size()).toBe(0);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used item when full', () => {
      const cache = new LRUCache<string>({ maxSize: 3 });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Cache is full, adding new item should evict key1 (oldest)
      cache.set('key4', 'value4');

      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(true);
      expect(cache.has('key3')).toBe(true);
      expect(cache.has('key4')).toBe(true);
    });

    it('should update access order when getting', () => {
      const cache = new LRUCache<string>({ maxSize: 3 });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Access key1, making it most recently used
      cache.get('key1');

      // Adding new item should evict key2 (now oldest)
      cache.set('key4', 'value4');

      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(false);
      expect(cache.has('key3')).toBe(true);
      expect(cache.has('key4')).toBe(true);
    });

    it('should call onEvict callback when evicting', () => {
      const onEvict = jest.fn();
      const cache = new LRUCache<string>({
        maxSize: 2,
        onEvict
      });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3'); // Should evict key1

      expect(onEvict).toHaveBeenCalledWith('key1', 'value1');
    });
  });

  describe('memory management', () => {
    it('should track memory usage with size parameter', () => {
      const cache = new LRUCache<ArrayBuffer>({
        maxSize: 100,
        maxMemory: 1000
      });

      const buffer1 = new ArrayBuffer(400);
      const buffer2 = new ArrayBuffer(400);

      cache.set('buf1', buffer1, 400);
      cache.set('buf2', buffer2, 400);

      expect(cache.memoryUsage()).toBe(800);
    });

    it('should evict when memory limit exceeded', () => {
      const cache = new LRUCache<ArrayBuffer>({
        maxSize: 100,
        maxMemory: 500
      });

      const buffer1 = new ArrayBuffer(300);
      const buffer2 = new ArrayBuffer(300);

      cache.set('buf1', buffer1, 300);
      cache.set('buf2', buffer2, 300); // Should evict buf1

      expect(cache.has('buf1')).toBe(false);
      expect(cache.has('buf2')).toBe(true);
      expect(cache.memoryUsage()).toBe(300);
    });
  });

  describe('statistics', () => {
    it('should report correct size', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });

      expect(cache.size()).toBe(0);

      cache.set('key1', 'value1');
      expect(cache.size()).toBe(1);

      cache.set('key2', 'value2');
      expect(cache.size()).toBe(2);

      cache.delete('key1');
      expect(cache.size()).toBe(1);
    });

    it('should return all keys', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      const keys = cache.keys();
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys).toContain('key3');
      expect(keys.length).toBe(3);
    });
  });

  describe('edge cases', () => {
    it('should handle updating existing key', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });

      cache.set('key1', 'value1');
      cache.set('key1', 'updated');

      expect(cache.get('key1')).toBe('updated');
      expect(cache.size()).toBe(1);
    });

    it('should handle empty cache operations', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });

      expect(cache.size()).toBe(0);
      expect(cache.get('any')).toBeUndefined();
      expect(cache.delete('any')).toBe(false);
      expect(cache.keys()).toEqual([]);
    });

    it('should handle maxSize of 1', () => {
      const cache = new LRUCache<string>({ maxSize: 1 });

      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');

      cache.set('key2', 'value2');
      expect(cache.has('key1')).toBe(false);
      expect(cache.get('key2')).toBe('value2');
    });
  });
});
