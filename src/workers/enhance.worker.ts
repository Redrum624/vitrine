import { enhanceImage, enhanceAiUpscaled, EnhanceParams } from '../utils/enhanceChain';

interface EnhancePayload { rgba: Float32Array; width: number; height: number; params: EnhanceParams }
interface EnhanceRequest { type: 'ENHANCE' | 'ENHANCE_AI_FINISH'; id: number; data: EnhancePayload }
const ctx = self as unknown as Worker;
ctx.onmessage = (e: MessageEvent<EnhanceRequest>) => {
  const msg = e.data;
  if (!msg) return;
  if (msg.type === 'ENHANCE') {
    try {
      const { rgba, width, height, params } = msg.data;
      const r = enhanceImage(rgba, width, height, params);
      ctx.postMessage({ type: 'ENHANCE_COMPLETE', id: msg.id, enhanced: r.enhanced, base: r.base, width: r.width, height: r.height }, [r.enhanced.buffer, r.base.buffer]);
    } catch (err) {
      ctx.postMessage({ type: 'ENHANCE_ERROR', id: msg.id, error: err instanceof Error ? err.message : String(err) });
    }
  } else if (msg.type === 'ENHANCE_AI_FINISH') {
    // W4 R4: the AI-route finishing pass (chroma denoise / detail graft / CAS / chroma clean on
    // the model output at final resolution) — previously a whole-buffer main-thread stall parked
    // at 92% progress. enhanceAiUpscaled may return the INPUT reference on the neutral-sliders
    // pass-through; the transfer list still moves that buffer back to the caller correctly.
    try {
      const { rgba, width, height, params } = msg.data;
      const out = enhanceAiUpscaled(rgba, width, height, params);
      ctx.postMessage({ type: 'ENHANCE_AI_FINISH_COMPLETE', id: msg.id, rgba: out }, [out.buffer]);
    } catch (err) {
      ctx.postMessage({ type: 'ENHANCE_AI_FINISH_ERROR', id: msg.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
};
