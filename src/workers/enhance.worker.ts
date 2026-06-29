import { enhanceImage, EnhanceParams } from '../utils/enhanceChain';

interface EnhanceRequest { type: 'ENHANCE'; id: number; data: { rgba: Float32Array; width: number; height: number; params: EnhanceParams } }
const ctx = self as unknown as Worker;
ctx.onmessage = (e: MessageEvent<EnhanceRequest>) => {
  const msg = e.data;
  if (!msg || msg.type !== 'ENHANCE') return;
  try {
    const { rgba, width, height, params } = msg.data;
    const r = enhanceImage(rgba, width, height, params);
    ctx.postMessage({ type: 'ENHANCE_COMPLETE', id: msg.id, enhanced: r.enhanced, base: r.base, width: r.width, height: r.height }, [r.enhanced.buffer, r.base.buffer]);
  } catch (err) {
    ctx.postMessage({ type: 'ENHANCE_ERROR', id: msg.id, error: err instanceof Error ? err.message : String(err) });
  }
};
