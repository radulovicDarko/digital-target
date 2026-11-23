import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Polygon, Rect, Text as SvgText } from 'react-native-svg';

import { createDetectorCalibrationClient } from '@/api/client';
import type { DetectorStatus } from '@/api/schemas';
import { supportsDetectorWorkflow } from '@/api/schemas';
import { queryKeys } from '@/api/queryKeys';
import { Button, Card, Text } from '@/components';
import { logger } from '@/storage/logger';

import { imagePointFromView, roiFromCorners, type PixelPoint } from './previewGeometry';

type AvailableStatus = Extract<DetectorStatus, { available: true }>;
type Props = {
  baseUrl: string; token?: string; isDemo: boolean; rangeId: string;
  prepareOnMount?: boolean;
  workflowBusy?: boolean;
  onStatusChange?: (status: AvailableStatus) => void;
};
type Editor = { kind: 'roi' | 'points'; snapshot: string; status: AvailableStatus; points: PixelPoint[] };

export const DetectorControls = ({
  baseUrl, token, isDemo, rangeId, prepareOnMount = false, workflowBusy = false, onStatusChange,
}: Props) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const api = useMemo(() => createDetectorCalibrationClient(baseUrl, token), [baseUrl, token]);
  const [status, setStatus] = useState<DetectorStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const preparedFor = useRef<string | null>(null);

  const report = useCallback((failure: unknown) => {
    const message = failure instanceof Error ? failure.message : String(failure);
    setError(message);
    void logger.warn('cal', `detector calibration: ${message}`);
  }, []);

  useEffect(() => {
    if (isDemo || editor || busy || workflowBusy) return;
    let cancelled = false;
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        let next = await api.status();
        if (!cancelled && prepareOnMount && preparedFor.current !== baseUrl
          && next.available && supportsDetectorWorkflow(next) && next.camera.controls_supported) {
          preparedFor.current = baseUrl;
          next = await api.setCaptureMode('alignment');
        }
        if (!cancelled) {
          setStatus(next);
          if (next.available) onStatusChange?.(next);
        }
      } catch (failure) {
        if (!cancelled) report(failure);
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 1500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [api, baseUrl, isDemo, editor, busy, workflowBusy, prepareOnMount, onStatusChange, report]);

  const apply = async (operation: () => Promise<DetectorStatus>, closeEditor = false) => {
    setBusy(true);
    setError(null);
    try {
      const next = await operation();
      if (!next.available) throw new Error(next.error ?? t('laserCalibration.unavailable'));
      setStatus(next);
      onStatusChange?.(next);
      if (status?.available && next.mapping_mode !== status.mapping_mode) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.targetConfig(rangeId) });
      }
      if (closeEditor) setEditor(null);
    } catch (failure) {
      report(failure);
    } finally {
      setBusy(false);
    }
  };

  const startEditing = async (kind: Editor['kind']) => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.status();
      if (!next.available) throw new Error(t('laserCalibration.unavailable'));
      if (next.alignment_locked) throw new Error(t('laserCalibration.unlockFirst'));
      setImageLoaded(false);
      setEditor({
        kind, status: next, points: [],
        snapshot: `${baseUrl}/api/detector/snapshot.jpg?t=${Date.now()}`,
      });
    } catch (failure) { report(failure); }
    finally { setBusy(false); }
  };

  const selectPoint = (x: number, y: number) => {
    if (!editor || !imageLoaded || busy) return;
    const limit = editor.kind === 'roi' ? 2 : 4;
    if (editor.points.length >= limit) return;
    try {
      const point = imagePointFromView({ x, y }, {
        ...layout, sourceWidth: editor.status.frame_size[0], sourceHeight: editor.status.frame_size[1],
      });
      if (point) {
        const points = [...editor.points, point];
        const [first] = editor.points;
        if (editor.kind === 'roi' && first) {
          roiFromCorners(first, point, ...editor.status.frame_size);
        }
        setEditor({ ...editor, points });
      }
    } catch (failure) { report(failure); }
  };

  const [firstCorner, secondCorner] = editor?.points ?? [];
  const selectedRoi = editor?.kind === 'roi' && editor.points.length === 2 && firstCorner && secondCorner
    ? roiFromCorners(firstCorner, secondCorner, ...editor.status.frame_size) : null;

  const save = async () => {
    if (!editor) return;
    const { status: snapshot, points, kind } = editor;
    try {
      if (kind === 'roi' && !selectedRoi) throw new Error(t('laserCalibration.roiHelp'));
      if (kind === 'points' && points.length !== 4) throw new Error(t('laserCalibration.pointsHelp'));
      const body = {
        frame_size: snapshot.frame_size, version: snapshot.version,
        ...(kind === 'roi'
          ? { roi: selectedRoi }
          : { image_points: points.map((point): [number, number] => [point.x, point.y]) }),
      };
      await apply(() => api.updateCalibration(body), true);
    } catch (failure) { report(failure); }
  };

  const available = status?.available ? status : null;
  const workflowAvailable = !!available && supportsDetectorWorkflow(available);
  const controlsBusy = busy || workflowBusy;
  const geometryDisabled = controlsBusy || !!editor || !!available?.alignment_locked;
  const required = editor?.kind === 'roi' ? 2 : 4;

  return (
    <Card>
      <Text variant="bodyBold">{t('laserCalibration.title')}</Text>
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {isDemo ? <Text>{t('laserCalibration.demoUnavailable')}</Text> : null}
      {!isDemo && !available ? <Text>{t('laserCalibration.unavailable')}</Text> : null}
      {available && !isDemo ? (
        <>
          {available.error ? <Text variant="caption">{available.error}</Text> : null}
          <Text>
            {t(!workflowAvailable ? 'laserCalibration.workflowNeedsUpdate' : available.capture_mode === 'alignment'
              ? 'laserCalibration.alignmentMode'
              : available.alignment_locked ? 'laserCalibration.detectionLocked' : 'laserCalibration.detectionMode')}
          </Text>
          {workflowAvailable ? <Text variant="caption">{t(available.capture_mode === 'alignment'
            ? 'laserCalibration.positionHelp' : available.detector.state === 'ready'
              ? 'laserCalibration.readyHelp' : 'laserCalibration.waitReady')}</Text> : null}
          {!available.camera.controls_supported
            ? <Text>{t('laserCalibration.cameraUnsupported')}</Text> : null}
          <View style={styles.actions}>
            <Button variant="secondary" disabled={controlsBusy || !!editor || !workflowAvailable}
              onPress={() => void apply(api.clearPreviewHits)}>
              {t('laserCalibration.clearHits')}
            </Button>
          </View>
          <Text variant="caption">{t('laserCalibration.clearHitsHelp')}</Text>
          <Button variant="ghost" onPress={() => setShowAdvanced(!showAdvanced)}
            accessibilityState={{ expanded: showAdvanced }}>
            {t(showAdvanced ? 'laserCalibration.hideAdvanced' : 'laserCalibration.advanced')}
          </Button>
          {showAdvanced ? (
          <>
          <Text variant="caption">
            {`${available.mapping_mode}: ${available.detector.state} (${available.detector.reason})`}
          </Text>
          <Text variant="caption">
            {`${t('laserCalibration.camera')}: ${JSON.stringify(available.camera.measured)}`}
          </Text>
          {available.mapping_mode === 'fixed_center'
            ? <Text variant="caption">{t('laserCalibration.fixedHelp')}</Text> : null}
          <View style={styles.actions}>
            <Button disabled={controlsBusy || !!editor} onPress={() => void apply(api.resetBackground)}>
              {t('laserCalibration.resetBackground')}
            </Button>
            <Button disabled={controlsBusy || !!editor || available.capture_mode === 'alignment'}
              onPress={() => void apply(() => api.setDebug(!available.debug))}>
              {t(available.debug ? 'laserCalibration.debugOff' : 'laserCalibration.debugOn')}
            </Button>
            <Button disabled={geometryDisabled} onPress={() => void startEditing('roi')}>
              {t('laserCalibration.editRoi')}
            </Button>
            <Button disabled={geometryDisabled} onPress={() => void startEditing('points')}>
              {t('laserCalibration.editPoints')}
            </Button>
            <Button disabled={geometryDisabled} onPress={() => void apply(api.calibrateArUco)}>
              {t('laserCalibration.aruco')}
            </Button>
            <Button disabled={geometryDisabled || (!available.calibrated && available.mapping_mode !== 'homography')}
              onPress={() => void apply(() => api.updateCalibration({
                frame_size: available.frame_size, version: available.version,
                mapping_mode: available.mapping_mode === 'homography' ? 'fixed_center' : 'homography',
              }))}>
              {t(available.mapping_mode === 'homography' ? 'laserCalibration.useFixed' : 'laserCalibration.useHomography')}
            </Button>
            <Button disabled={geometryDisabled} onPress={() => void apply(() => api.updateCalibration({
              frame_size: available.frame_size, version: available.version, roi: null,
            }))}>
              {t('laserCalibration.defaultRoi')}
            </Button>
          </View>
          </>
          ) : null}
        </>
      ) : null}
      {editor ? (
        <>
          <Text>{t(editor.kind === 'roi' ? 'laserCalibration.roiHelp' : 'laserCalibration.pointsHelp')}</Text>
          {editor.kind === 'points' ? (
            <Text variant="caption">{editor.status.target_points.map((point, i) => `${i + 1}: (${point.join(', ')}) mm`).join(' | ')}</Text>
          ) : null}
          <Pressable
            style={[styles.canvas, { aspectRatio: editor.status.frame_size[0] / editor.status.frame_size[1] }]}
            accessibilityLabel={t('laserCalibration.selectPoint')}
            onLayout={(event) => setLayout(event.nativeEvent.layout)}
            onPress={(event) => selectPoint(event.nativeEvent.locationX, event.nativeEvent.locationY)}
          >
            <Image testID="detector-calibration-snapshot"
              source={{ uri: editor.snapshot, headers: token ? { Authorization: `Bearer ${token}` } : undefined }}
              resizeMode="contain" style={StyleSheet.absoluteFill}
              onLoad={() => setImageLoaded(true)}
              onError={() => { setImageLoaded(false); report(new Error(t('laserCalibration.snapshotFailed'))); }} />
            <Svg pointerEvents="none" style={StyleSheet.absoluteFill}
              viewBox={`0 0 ${editor.status.frame_size[0]} ${editor.status.frame_size[1]}`}>
              {selectedRoi ? <Rect x={selectedRoi[0]} y={selectedRoi[1]} width={selectedRoi[2]} height={selectedRoi[3]}
                fill="none" stroke="lime" strokeWidth={2} /> : null}
              {editor.kind === 'points' && editor.points.length === 4 ? (
                <Polygon points={editor.points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="yellow" strokeWidth={2} />
              ) : null}
              {editor.points.map((p, i) => (
                <G key={i}>
                  <Circle cx={p.x} cy={p.y} r={5} fill="yellow" />
                  <SvgText x={p.x + 8} y={p.y - 8} fill="yellow" fontSize={16}>{i + 1}</SvgText>
                </G>
              ))}
            </Svg>
          </Pressable>
          <Text>{`${editor.points.length}/${required}`}</Text>
          <View style={styles.actions}>
            <Button disabled={busy || editor.points.length !== required || !imageLoaded}
              testID="detector-calibration-save" onPress={() => void save()}>{t('common.save')}</Button>
            <Button disabled={busy} onPress={() => setEditor({ ...editor, points: [] })}>{t('laserCalibration.clearPoints')}</Button>
            <Button disabled={busy} onPress={() => setEditor(null)}>{t('common.cancel')}</Button>
          </View>
        </>
      ) : null}
    </Card>
  );
};

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 },
  canvas: { width: '100%', backgroundColor: '#000' },
});
