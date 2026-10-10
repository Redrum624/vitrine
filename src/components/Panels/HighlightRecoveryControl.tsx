import { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { rawImageService } from '../../services/RawImageService';
import { imageProcessingPipeline } from '../../services/ImageProcessingPipeline';
import type { ImageFileInfo } from '../../services/FileSystemService';
import { SectionLabel } from '../Controls/SectionLabel';
import { SliderRow } from '../Controls/SliderRow';

const HR_MODULE_ID = 'highlightrecovery';

/** Read the live highlight-recovery strength (0..100) off the registered pipeline module. */
function readHrStrength(): number {
  const m = imageProcessingPipeline.getModule(HR_MODULE_ID) as
    | { getParams?: () => { strength?: number } }
    | undefined;
  return m?.getParams?.().strength ?? 0;
}

/**
 * Highlight recovery for RAW photos — rebuilds a blown channel from the ones that survived.
 * A post-decode pipeline module (it never re-decodes the file), so it lives with the other tone
 * controls under Basic Adjustments. It used to sit in the RAW Decode panel, which was removed
 * when RAW decoding became one fixed, setting-free path.
 *
 * `currentImage` is App's live selection (the store's `currentImage` is never populated).
 */
export function HighlightRecoveryControl({ currentImage }: { currentImage?: ImageFileInfo | null }) {
  const externalParamsVersion = useAppStore((s) => s.externalParamsVersion);
  const [strength, setStrength] = useState<number>(readHrStrength);

  // Re-read on image switch and on external param changes (history restore, presets, paste).
  useEffect(() => {
    setStrength(readHrStrength());
  }, [currentImage?.id, externalParamsVersion]);

  if (!currentImage || !rawImageService.isRawFile(currentImage.path)) return null;

  const apply = (value: number) => {
    setStrength(value);
    const m = imageProcessingPipeline.getModule(HR_MODULE_ID) as
      | { setParams?: (p: { strength: number }) => void }
      | undefined;
    m?.setParams?.({ strength: value });
    imageProcessingPipeline.invalidateModuleCache(HR_MODULE_ID);
    useAppStore.getState().triggerReprocessing(); // no re-decode — just re-runs the pipeline
  };

  return (
    <div className="flex flex-col" style={{ gap: 10, marginTop: 18 }}>
      <SectionLabel>RAW photo</SectionLabel>
      <SliderRow
        label="Highlight recovery"
        value={strength}
        defaultValue={0}
        min={0}
        max={100}
        step={1}
        onChange={apply}
      />
    </div>
  );
}

export default HighlightRecoveryControl;
