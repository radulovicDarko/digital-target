import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { createDetectorCalibrationClient } from '@/api/client';
import type { DetectorCalibrationUpdate, DetectorStatus } from '@/api/schemas';
import { DetectorStatusSchema } from '@/api/schemas';
import { DetectorControls } from '../DetectorControls';

jest.mock('@/api/client', () => ({ createDetectorCalibrationClient: jest.fn() }));
jest.mock('@/storage/logger', () => ({ logger: { warn: jest.fn() } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock('@/components', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    Card: View,
    Text,
    Button: ({ children, ...props }: { children: ReactNode }) =>
      React.createElement(Pressable, props, React.createElement(Text, {}, children)),
  };
});
jest.mock('react-native-svg', () => {
  const { Text, View } = require('react-native');
  return { __esModule: true, default: View, Circle: View, G: View, Polygon: View, Rect: View, Text };
});

const status: Extract<DetectorStatus, { available: true }> = {
  available: true, frame_size: [160, 120], roi: null, image_points: [],
  target_points: [[0, 0], [90, 0], [90, 90], [0, 90]], target_size: [90, 90],
  mapping_mode: 'fixed_center', calibrated: false, error: null, version: 42, debug: false,
  capture_mode: 'alignment', alignment_locked: false, preview_hits: 3,
  detector: { state: 'ready', reason: 'quiet', confirmation: 0, cooldown: 0, armed: true, refinement: 'weighted', rejected: [] },
  camera: { requested: {}, measured: {}, controls_supported: true },
};
const api = {
  status: jest.fn<Promise<DetectorStatus>, []>(),
  resetBackground: jest.fn<Promise<DetectorStatus>, []>(),
  clearPreviewHits: jest.fn<Promise<DetectorStatus>, []>(),
  setCaptureMode: jest.fn<Promise<DetectorStatus>, ['alignment' | 'detection']>(),
  setDebug: jest.fn<Promise<DetectorStatus>, [boolean]>(),
  updateCalibration: jest.fn<Promise<DetectorStatus>, [DetectorCalibrationUpdate]>(),
  calibrateArUco: jest.fn<Promise<DetectorStatus>, []>(),
};

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'queueMicrotask', 'nextTick'] });
  jest.clearAllMocks();
  api.status.mockResolvedValue(status);
  api.setCaptureMode.mockResolvedValue(status);
  api.clearPreviewHits.mockResolvedValue({ ...status, preview_hits: 0 });
  jest.mocked(createDetectorCalibrationClient).mockReturnValue(api);
});
afterEach(() => jest.useRealTimers());

it('clears only preview hits without resetting the detector or calibration', async () => {
  jest.useRealTimers();
  const onStatusChange = jest.fn();
  const screen = await render(<DetectorControls baseUrl="http://pi" isDemo={false} rangeId="pi-1"
    onStatusChange={onStatusChange} />);
  await waitFor(() => expect(screen.getByText('laserCalibration.clearHits')).toBeTruthy());
  await fireEvent.press(screen.getByText('laserCalibration.clearHits'));
  await waitFor(() => expect(api.clearPreviewHits).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ preview_hits: 0 })));
  expect(api.resetBackground).not.toHaveBeenCalled();
  expect(api.updateCalibration).not.toHaveBeenCalled();
});

it('keeps advanced geometry locked but allows clearing markers on the locked target', async () => {
  const locked = { ...status, capture_mode: 'detection' as const, alignment_locked: true };
  api.status.mockResolvedValueOnce(locked);
  const onStatusChange = jest.fn();
  const screen = await render(<DetectorControls baseUrl="http://pi" isDemo={false} rangeId="pi-1"
    onStatusChange={onStatusChange} />);
  await waitFor(() => expect(screen.getByText('laserCalibration.detectionLocked')).toBeTruthy());
  expect(screen.queryByText('laserCalibration.editRoi')).toBeNull();
  await fireEvent.press(screen.getByText('laserCalibration.advanced'));
  await fireEvent.press(screen.getByText('laserCalibration.editRoi'));
  expect(api.status).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText('laserCalibration.selectPoint')).toBeNull();
  await fireEvent.press(screen.getByText('laserCalibration.clearHits'));
  await waitFor(() => expect(api.clearPreviewHits).toHaveBeenCalledTimes(1));
  expect(api.setCaptureMode).not.toHaveBeenCalled();
});

it('prepares a visible target on entering the calibration screen', async () => {
  api.status.mockResolvedValueOnce({ ...status, capture_mode: 'detection', alignment_locked: true });
  const onStatusChange = jest.fn();
  await render(<DetectorControls baseUrl="http://pi" isDemo={false} rangeId="pi-1"
    prepareOnMount onStatusChange={onStatusChange} />);
  await waitFor(() => expect(api.setCaptureMode).toHaveBeenCalledWith('alignment'));
  await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith(status));
  expect(api.clearPreviewHits).not.toHaveBeenCalled();
});

it('keeps old Pi firmware usable without calling unsupported workflow endpoints', async () => {
  const oldStatus = DetectorStatusSchema.parse({
    ...status, capture_mode: undefined, alignment_locked: undefined, preview_hits: undefined,
  });
  api.status.mockResolvedValue(oldStatus);
  const screen = await render(<DetectorControls baseUrl="http://pi" isDemo={false} rangeId="pi-1" prepareOnMount />);
  await waitFor(() => expect(screen.getByText('laserCalibration.workflowNeedsUpdate')).toBeTruthy());
  await fireEvent.press(screen.getByText('laserCalibration.clearHits'));
  expect(api.setCaptureMode).not.toHaveBeenCalled();
  expect(api.clearPreviewHits).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('laserCalibration.advanced'));
  expect(screen.getByText('laserCalibration.editRoi')).toBeTruthy();
});

it('keeps a failed background command visible even after successful status polling', async () => {
  api.resetBackground.mockRejectedValueOnce(new Error('Reset failed'));
  const screen = await render(<DetectorControls baseUrl="http://pi" isDemo={false} rangeId="pi-1" />);
  await waitFor(() => expect(screen.getByText('laserCalibration.advanced')).toBeTruthy());
  await fireEvent.press(screen.getByText('laserCalibration.advanced'));
  await fireEvent.press(screen.getByText('laserCalibration.resetBackground'));
  await waitFor(() => expect(screen.getByText('Reset failed')).toBeTruthy());
  await act(async () => { jest.advanceTimersByTime(1600); });
  expect(screen.getByText('Reset failed')).toBeTruthy();
});

it('sends source-pixel ROI/version and keeps the snapshot editor open on save failure', async () => {
  api.updateCalibration.mockRejectedValueOnce(new Error('Stale snapshot'));
  const screen = await render(<DetectorControls baseUrl="http://pi" isDemo={false} rangeId="pi-1" />);
  await waitFor(() => expect(screen.getByText('laserCalibration.advanced')).toBeTruthy());
  await fireEvent.press(screen.getByText('laserCalibration.advanced'));
  await fireEvent.press(screen.getByText('laserCalibration.editRoi'));
  await waitFor(() => expect(screen.getByLabelText('laserCalibration.selectPoint')).toBeTruthy());
  const canvas = screen.getByLabelText('laserCalibration.selectPoint');
  await fireEvent(canvas, 'layout', { nativeEvent: { layout: { width: 320, height: 240, x: 0, y: 0 } } });
  await fireEvent(screen.getByTestId('detector-calibration-snapshot'), 'load');
  await fireEvent.press(canvas, { nativeEvent: { locationX: 20, locationY: 20 } });
  await fireEvent.press(canvas, { nativeEvent: { locationX: 240, locationY: 200 } });
  await fireEvent.press(screen.getByTestId('detector-calibration-save'));
  await waitFor(() => expect(screen.getByText('Stale snapshot')).toBeTruthy());
  expect(api.updateCalibration).toHaveBeenCalledWith({ frame_size: [160, 120], version: 42, roi: [10, 10, 110, 90] });
  expect(screen.getByLabelText('laserCalibration.selectPoint')).toBeTruthy();
  await fireEvent.press(screen.getByText('common.cancel'));
  expect(screen.queryByLabelText('laserCalibration.selectPoint')).toBeNull();
});
