export type PixelPoint = { x: number; y: number };
export type ImageViewport = {
  width: number; height: number;
  sourceWidth: number; sourceHeight: number;
  zoom?: number; panX?: number; panY?: number;
};

export const imagePointFromView = (
  point: PixelPoint, viewport: ImageViewport,
): PixelPoint | null => {
  const { width, height, sourceWidth, sourceHeight, zoom = 1, panX = 0, panY = 0 } = viewport;
  if (
    ![point.x, point.y, width, height, sourceWidth, sourceHeight, zoom, panX, panY].every(Number.isFinite)
    || Math.min(width, height, sourceWidth, sourceHeight, zoom) <= 0
  ) throw new Error('Invalid preview geometry');
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const x = ((point.x - width / 2 - panX) / zoom + sourceWidth * scale / 2) / scale;
  const y = ((point.y - height / 2 - panY) / zoom + sourceHeight * scale / 2) / scale;
  if (x < 0 || y < 0 || x >= sourceWidth || y >= sourceHeight) return null;
  return { x, y };
};

export const roiFromCorners = (
  a: PixelPoint, b: PixelPoint, sourceWidth: number, sourceHeight: number,
): [number, number, number, number] => {
  if (![a.x, a.y, b.x, b.y, sourceWidth, sourceHeight].every(Number.isFinite)) {
    throw new Error('ROI coordinates must be finite');
  }
  const x = Math.max(0, Math.floor(Math.min(a.x, b.x)));
  const y = Math.max(0, Math.floor(Math.min(a.y, b.y)));
  const right = Math.min(sourceWidth, Math.ceil(Math.max(a.x, b.x)));
  const bottom = Math.min(sourceHeight, Math.ceil(Math.max(a.y, b.y)));
  if (right <= x || bottom <= y) throw new Error('ROI must have positive width and height');
  return [x, y, right - x, bottom - y];
};
