// Entry point for libraw-wasm testing — Vite will resolve the import
import LibRaw from 'libraw-wasm';
(window as unknown as Record<string, unknown>).LibRaw = LibRaw;
console.log('LibRaw loaded:', typeof LibRaw);
