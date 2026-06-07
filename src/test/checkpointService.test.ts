import { checkpointService } from '../services/CheckpointService';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { imageService } from '../services/ImageService';
import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';

describe('CheckpointService', () => {
  const basicadj = () => imageProcessingPipeline.getModule<BasicAdjustmentsModule>('basicadj')!;

  beforeEach(() => {
    jest.spyOn(imageService, 'getCurrentImage').mockReturnValue(
      { width: 10, height: 10, filePath: '/x.jpg', data: new Float32Array(400) } as never,
    );
    imageProcessingPipeline.resetAllModules();
    checkpointService.clear();
  });

  afterEach(() => {
    checkpointService.flush(); // clears any pending debounce timers
    jest.restoreAllMocks();
  });

  it('records one checkpoint per distinct state and de-dupes identical states', () => {
    basicadj().setParams({ exposure: 0.3 });
    checkpointService.record('A');
    checkpointService.record('A again'); // identical state → no new checkpoint
    expect(checkpointService.getCheckpoints().length).toBe(1);

    basicadj().setParams({ exposure: 0.6 });
    checkpointService.record('B');
    expect(checkpointService.getCheckpoints().length).toBe(2);
  });

  it('restore() applies a checkpoint and KEEPS the full list', () => {
    basicadj().setParams({ exposure: 0.3 });
    checkpointService.record('A');
    const firstId = checkpointService.getCheckpoints()[0].id;

    basicadj().setParams({ exposure: 0.9 });
    checkpointService.record('B');
    expect(basicadj().getParams().exposure).toBeCloseTo(0.9, 5);

    expect(checkpointService.restore(firstId)).toBe(true);
    expect(basicadj().getParams().exposure).toBeCloseTo(0.3, 5); // state restored
    expect(checkpointService.getCheckpoints().length).toBe(2);   // list kept (not truncated)
    expect(checkpointService.getActiveId()).toBe(firstId);
  });

  it('record() is a no-op when no image is loaded', () => {
    (imageService.getCurrentImage as jest.Mock).mockReturnValue(null);
    checkpointService.record('X');
    expect(checkpointService.getCheckpoints().length).toBe(0);
  });
});
