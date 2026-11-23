import { imagePointFromView, roiFromCorners } from '../previewGeometry';

describe('calibration source-pixel geometry', () => {
  const viewport = { width: 400, height: 300, sourceWidth: 960, sourceHeight: 540 };
  it('removes contain letterboxing and rejects taps outside the image', () => {
    expect(imagePointFromView({ x: 200, y: 150 }, viewport)).toEqual({ x: 480, y: 270 });
    expect(imagePointFromView({ x: 100, y: 10 }, viewport)).toBeNull();
  });
  it('inverts zoom and pan around the image centre exactly once', () => {
    expect(imagePointFromView({ x: 250, y: 130 }, { ...viewport, zoom: 2, panX: 50, panY: -20 }))
      .toEqual({ x: 480, y: 270 });
  });
  it('constructs bounded integer ROIs from either corner order', () => {
    expect(roiFromCorners({ x: 90.8, y: 80.1 }, { x: 10.2, y: 20.4 }, 100, 100))
      .toEqual([10, 20, 81, 61]);
    expect(() => roiFromCorners({ x: 10, y: 10 }, { x: 10, y: 10 }, 100, 100)).toThrow();
  });
  it('rejects non-finite coordinates instead of persisting invalid geometry', () => {
    expect(() => imagePointFromView({ x: NaN, y: 1 }, viewport)).toThrow();
  });
});
