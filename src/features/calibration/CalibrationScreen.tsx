import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApiClient } from '@/api/hooks';
import { createDetectorCalibrationClient } from '@/api/client';
import type { DetectorStatus } from '@/api/schemas';
import { supportsDetectorWorkflow } from '@/api/schemas';
import { DEMO_LOCAL_BASE_URL, isDemoPairing } from '@/api/demo';
import { Button, Card, ScreenHeader, Slider, Text } from '@/components';
import { usePairingStore } from '@/state/pairingStore';
import { logger } from '@/storage/logger';
import { securePairings } from '@/storage/securePairings';
import { useTheme } from '@/theme';

import { LivePreview } from './LivePreview';
import { DetectorControls } from './DetectorControls';

type Props = { onCompleted: () => void };

type Tweaks = {
  scale_factor: number;
  offset_x_mm: number;
  offset_y_mm: number;
  rotation_deg: number;
  aspect_ratio: number;
  keystone_h: number;
  keystone_v: number;
  keystone_d1: number;
  keystone_d2: number;
  paper_rotation_deg: number;
  paper_scale: number;
};

const DEFAULT_TWEAKS: Tweaks = {
  scale_factor: 1.0,
  offset_x_mm: 0.0,
  offset_y_mm: 0.0,
  rotation_deg: 0.0,
  aspect_ratio: 1.0,
  keystone_h: 0.0,
  keystone_v: 0.0,
  keystone_d1: 0.0,
  keystone_d2: 0.0,
  paper_rotation_deg: 0.0,
  paper_scale: 1.0,
};

const POSITION_DEFAULTS: Partial<Tweaks> = {
  offset_x_mm: 0,
  offset_y_mm: 0,
};
const SHAPE_DEFAULTS: Partial<Tweaks> = {
  scale_factor: 1,
  aspect_ratio: 1,
  rotation_deg: 0,
};
const PERSPECTIVE_DEFAULTS: Partial<Tweaks> = {
  keystone_h: 0,
  keystone_v: 0,
  keystone_d1: 0,
  keystone_d2: 0,
};
const PAPER_DEFAULTS: Partial<Tweaks> = {
  paper_rotation_deg: 0,
  paper_scale: 1,
};

// How long to wait after the last slider change before sending the latest
// value to the Pi. Keeps network traffic sane during a continuous drag.
const TWEAK_DEBOUNCE_MS = 80;

export const CalibrationScreen = ({ onCompleted }: Props) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const active = usePairingStore((s) => s.active);
  const setActive = usePairingStore((s) => s.setActive);
  const upsert = usePairingStore((s) => s.upsert);
  const apiClient = useApiClient();

  const [savingFreeze, setSavingFreeze] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [autoAdjusting, setAutoAdjusting] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [tweaks, setTweaks] = useState<Tweaks>(DEFAULT_TWEAKS);
  const [detectorStatus, setDetectorStatus] = useState<Extract<DetectorStatus, { available: true }> | null>(null);

  const isDemo = isDemoPairing(active);
  const previewBaseUrl = isDemo ? DEMO_LOCAL_BASE_URL : active?.baseUrl;
  const detectorApi = useMemo(() => previewBaseUrl
    ? createDetectorCalibrationClient(previewBaseUrl, active?.token) : null, [previewBaseUrl, active?.token]);
  const workflowSupported = !!detectorStatus && supportsDetectorWorkflow(detectorStatus)
    && detectorStatus.camera.controls_supported;
  const receiveStatus = useCallback((next: Extract<DetectorStatus, { available: true }>) => {
    setDetectorStatus(next);
    if (next.alignment_locked !== undefined) setFrozen(next.alignment_locked);
  }, []);

  // Latest-write-wins POST queue. Refs so a re-render mid-drag doesn't
  // cancel the outgoing request.
  const pendingTweaks = useRef<Tweaks | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);

  const flushTweaks = useCallback(async (): Promise<void> => {
    if (!previewBaseUrl) return;
    while (pendingTweaks.current || inFlight.current) {
      if (inFlight.current) {
        await inFlight.current;
        continue;
      }
      const next = pendingTweaks.current;
      if (!next) continue;
      pendingTweaks.current = null;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const request = Promise.resolve().then(async () => {
        const response = await fetch(`${previewBaseUrl}/api/calibration/tweaks`, {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      });
      inFlight.current = request;
      try {
        await request;
      } finally {
        clearTimeout(timeout);
        inFlight.current = null;
      }
    }
  }, [previewBaseUrl]);
  const reportTweaksFailure = useCallback((failure: unknown) => {
    void logger.warn('cal', `tweaks update failed: ${String(failure)}`);
    Alert.alert(t('common.error'), t('errors.network'));
  }, [t]);

  // Apply tweak locally instantly (no flicker), debounce the network write.
  const applyTweaks = useCallback(
    (patch: Partial<Tweaks>) => {
      if (frozen || savingFreeze || confirming) return;
      setTweaks((prev) => {
        const merged = { ...prev, ...patch };
        pendingTweaks.current = merged;
        if (flushTimer.current) clearTimeout(flushTimer.current);
        flushTimer.current = setTimeout(() => {
          flushTimer.current = null;
          void flushTweaks().catch(reportTweaksFailure);
        }, TWEAK_DEBOUNCE_MS);
        return merged;
      });
    },
    [flushTweaks, reportTweaksFailure, frozen, savingFreeze, confirming],
  );

  // Fetch current tweaks once on mount (or when the base url changes).
  useEffect(() => {
    if (!previewBaseUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${previewBaseUrl}/api/calibration/tweaks`);
        if (!r.ok) return;
        const body = (await r.json()) as Partial<Tweaks>;
        if (cancelled) return;
        setTweaks({
          scale_factor: Number(body.scale_factor ?? 1),
          offset_x_mm: Number(body.offset_x_mm ?? 0),
          offset_y_mm: Number(body.offset_y_mm ?? 0),
          rotation_deg: Number(body.rotation_deg ?? 0),
          aspect_ratio: Number(body.aspect_ratio ?? 1),
          keystone_h: Number(body.keystone_h ?? 0),
          keystone_v: Number(body.keystone_v ?? 0),
          keystone_d1: Number(body.keystone_d1 ?? 0),
          keystone_d2: Number(body.keystone_d2 ?? 0),
          paper_rotation_deg: Number(body.paper_rotation_deg ?? 0),
          paper_scale: Number(body.paper_scale ?? 1),
        });
      } catch (e) {
        void logger.warn('cal', `tweaks fetch failed: ${String(e)}`);
      }
    })();
    return () => {
      cancelled = true;
      if (flushTimer.current) clearTimeout(flushTimer.current);
    };
  }, [previewBaseUrl]);

  const onAutoAdjust = async () => {
    if (!previewBaseUrl) return;
    setAutoAdjusting(true);
    try {
      // Server collects ~25 frames over ~2.5s for olympic-grade stability.
      // Give it 8s before bailing so a slow stream still completes.
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(`${previewBaseUrl}/api/calibration/auto`, {
        method: 'POST',
        signal: ctrl.signal,
      });
      clearTimeout(timeoutId);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as Tweaks;
      // Cancel any pending debounced write so it doesn't overwrite the
      // server-truth we just received.
      pendingTweaks.current = null;
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
      setTweaks(body);
    } catch (e) {
      void logger.warn('cal', `auto adjust failed: ${String(e)}`);
      Alert.alert(t('common.error'), t('errors.network'));
    } finally {
      setAutoAdjusting(false);
    }
  };

  const onLockHorizontal = () => {
    applyTweaks({ rotation_deg: 0, paper_rotation_deg: 0 });
  };

  if (!active) return null;

  const postControl = async (path: string) => {
    if (isDemo) {
      const r = await fetch(`${previewBaseUrl}${path}`, { method: 'POST' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return;
    }
    if (!apiClient) throw new Error('No api client');
    const raw = (apiClient as { raw?: { post: (url: string) => Promise<unknown> } }).raw;
    if (!raw?.post) throw new Error('Pi control client is unavailable');
    await raw.post(path);
  };

  const onSaveOrRecalibrate = async () => {
    setSavingFreeze(true);
    try {
      await flushTweaks();
      if (!isDemo && workflowSupported && detectorApi) {
        const next = await detectorApi.setCaptureMode(frozen ? 'alignment' : 'detection');
        if (!next.available) throw new Error(next.error ?? t('laserCalibration.unavailable'));
        receiveStatus(next);
      } else {
        await postControl(frozen ? '/api/calibration/unfreeze' : '/api/calibration/freeze');
        setFrozen(!frozen);
      }
    } catch (e) {
      void logger.warn('cal', `freeze toggle failed: ${String(e)}`);
      Alert.alert(t('common.error'), e instanceof Error ? e.message : t('errors.network'));
    } finally {
      setSavingFreeze(false);
    }
  };

  const onConfirm = async () => {
    setConfirming(true);
    try {
      if (!isDemo && workflowSupported && detectorApi) {
        const next = await detectorApi.status();
        if (!next.available) throw new Error(next.error ?? t('laserCalibration.unavailable'));
        if (!next.alignment_locked || next.capture_mode !== 'detection') {
          throw new Error(t('laserCalibration.unlockFirst'));
        }
        if (next.error) throw new Error(next.error);
        if (next.detector.state !== 'ready') throw new Error(t('laserCalibration.waitReady'));
      } else {
        await postControl('/api/calibration/freeze');
      }
      const updated = { ...active, calibrationConfirmedAt: Date.now() };
      await securePairings.upsert(updated);
      upsert(updated);
      setActive(updated);
      onCompleted();
    } catch (e) {
      void logger.warn('cal', `confirm failed: ${String(e)}`);
      Alert.alert(t('common.error'), e instanceof Error ? e.message : t('errors.network'));
    } finally {
      setConfirming(false);
    }
  };

  const onBack = () => {
    Alert.alert(
      t('calibration.leaveTitle'),
      t('calibration.leaveBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.back'),
          style: 'destructive',
          onPress: async () => {
            // Drop the active range so the RootNavigator falls back to the
            // Pairing screen. The range record is preserved — the user can
            // pick it again from Settings → Manage Pi-evi.
            await securePairings.setActiveId(null);
            setActive(null);
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={[styles.root, { backgroundColor: theme.colors.bg }]}
      testID="calibration"
    >
      {/* Fixed header: title + live preview always visible. */}
      <View style={[styles.header, { paddingHorizontal: theme.spacing(4), paddingTop: theme.spacing(2), paddingBottom: theme.spacing(4) }]}>
        <ScreenHeader
          title={t('calibration.title')}
          subtitle={t('calibration.subtitle', { name: active.name })}
          onBack={onBack}
          backLabel={t('common.back')}
        />

        {previewBaseUrl ? (
          <View style={{ marginTop: theme.spacing(3) }}>
            <LivePreview
              baseUrl={previewBaseUrl}
              demoBadge={isDemo ? previewBaseUrl : undefined}
              frozenLabel={frozen ? t('calibration.frozenBadge') : undefined}
              accessibilityLabel={t('calibration.previewA11y')}
            />
          </View>
        ) : null}
        <Text variant="bodyBold" style={{ marginTop: theme.spacing(2) }}>
          {t(frozen ? 'laserCalibration.stepTest' : 'laserCalibration.stepPosition')}
        </Text>
        <Text variant="caption" color="textMuted">
          {t(frozen ? 'laserCalibration.darkPreviewHelp' : 'laserCalibration.positionHelp')}
        </Text>
      </View>

      {/* Scrollable controls below the fixed preview. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing(4),
          paddingBottom: theme.spacing(6),
          gap: theme.spacing(3),
        }}
        showsVerticalScrollIndicator={false}
      >
        {previewBaseUrl ? <DetectorControls baseUrl={previewBaseUrl} token={active.token}
          isDemo={isDemo} rangeId={active.id} prepareOnMount
          workflowBusy={savingFreeze || confirming} onStatusChange={receiveStatus} /> : null}
        {detectorStatus?.mapping_mode === 'legacy' ? (
          <Button variant="ghost" onPress={() => setShowLegacy(!showLegacy)}
            accessibilityState={{ expanded: showLegacy }}>
            {t('laserCalibration.legacyControls')}
          </Button>
        ) : null}
        {detectorStatus?.mapping_mode === 'legacy' && showLegacy ? (
        <View pointerEvents={frozen || savingFreeze || confirming ? 'none' : 'auto'}
          style={{ gap: theme.spacing(3), opacity: frozen ? 0.5 : 1 }}>
        <Card>
          <View style={styles.autoRow}>
            <Button
              onPress={() => void onAutoAdjust()}
              loading={autoAdjusting}
              disabled={frozen || savingFreeze || confirming}
              variant="primary"
            >
              <View style={styles.autoBtnContent}>
                <Ionicons name="sparkles" size={16} color={theme.colors.textInverse} />
                <Text color="textInverse" variant="bodyBold">
                  {' '}Auto adjust
                </Text>
              </View>
            </Button>
            <Button variant="secondary" onPress={onLockHorizontal} disabled={frozen || savingFreeze || confirming}>
              Lock horizontal
            </Button>
            <Button variant="ghost" onPress={() => applyTweaks(DEFAULT_TWEAKS)} disabled={frozen || savingFreeze || confirming}>
              Reset all
            </Button>
          </View>
          <Text variant="caption" color="textMuted" style={{ marginTop: theme.spacing(2) }}>
            Auto adjust averages ~25 frames over ~2.5s for olympic-grade
            stability. Lock horizontal forces both rotations to 0° (handy when
            the paper is mounted square but the bull detector picked up a few
            degrees of jitter).
          </Text>
        </Card>

        <CalibrationSection
          title="Position"
          subtitle="Move the centre of the rings."
          onResetSection={() => applyTweaks(POSITION_DEFAULTS)}
        >
          <Slider
            label="Centre X"
            value={tweaks.offset_x_mm}
            min={-50}
            max={50}
            step={0.5}
            format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} mm`}
            onChange={(v) => applyTweaks({ offset_x_mm: v })}
          />
          <Slider
            label="Centre Y"
            value={tweaks.offset_y_mm}
            min={-50}
            max={50}
            step={0.5}
            format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} mm`}
            onChange={(v) => applyTweaks({ offset_y_mm: v })}
          />
        </CalibrationSection>

        <CalibrationSection
          title="Size & Shape"
          subtitle="Scale, squash and rotate the rings to match the printed paper."
          onResetSection={() => applyTweaks(SHAPE_DEFAULTS)}
        >
          <Slider
            label="Ring size"
            value={tweaks.scale_factor}
            min={0.5}
            max={2.0}
            step={0.005}
            format={(v) => `${(v * 100).toFixed(1)}%`}
            onChange={(v) => applyTweaks({ scale_factor: v })}
          />
          <Slider
            label="Aspect Y/X"
            value={tweaks.aspect_ratio}
            min={0.5}
            max={2.0}
            step={0.005}
            format={(v) => `${(v * 100).toFixed(1)}%`}
            onChange={(v) => applyTweaks({ aspect_ratio: v })}
          />
          <Slider
            label="Rotation"
            value={tweaks.rotation_deg}
            min={-45}
            max={45}
            step={0.5}
            format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`}
            onChange={(v) => applyTweaks({ rotation_deg: v })}
          />
        </CalibrationSection>

        <CalibrationSection
          title="Camera angle"
          subtitle="Compensate for the camera being above/below, to the side, or off-axis from the paper."
          onResetSection={() => applyTweaks(PERSPECTIVE_DEFAULTS)}
        >
          <Slider
            label="Tilt up/down"
            value={tweaks.keystone_h}
            min={-0.5}
            max={0.5}
            step={0.005}
            format={(v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`}
            onChange={(v) => applyTweaks({ keystone_h: v })}
          />
          <Slider
            label="Tilt left/right"
            value={tweaks.keystone_v}
            min={-0.5}
            max={0.5}
            step={0.005}
            format={(v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`}
            onChange={(v) => applyTweaks({ keystone_v: v })}
          />
          <Slider
            label="Tilt ↘ (TL ↔ BR)"
            value={tweaks.keystone_d1}
            min={-0.5}
            max={0.5}
            step={0.005}
            format={(v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`}
            onChange={(v) => applyTweaks({ keystone_d1: v })}
          />
          <Slider
            label="Tilt ↙ (TR ↔ BL)"
            value={tweaks.keystone_d2}
            min={-0.5}
            max={0.5}
            step={0.005}
            format={(v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`}
            onChange={(v) => applyTweaks({ keystone_d2: v })}
          />
        </CalibrationSection>

        <CalibrationSection
          title="Paper outline"
          subtitle="Adjust just the blue rectangle (visual only — does not affect scoring)."
          onResetSection={() => applyTweaks(PAPER_DEFAULTS)}
        >
          <Slider
            label="Rotation"
            value={tweaks.paper_rotation_deg}
            min={-45}
            max={45}
            step={0.5}
            format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`}
            onChange={(v) => applyTweaks({ paper_rotation_deg: v })}
          />
          <Slider
            label="Size"
            value={tweaks.paper_scale}
            min={0.5}
            max={2.0}
            step={0.005}
            format={(v) => `${(v * 100).toFixed(1)}%`}
            onChange={(v) => applyTweaks({ paper_scale: v })}
          />
        </CalibrationSection>

        </View>
        ) : null}
      </ScrollView>
        <View style={[styles.actionRow, { padding: theme.spacing(4), borderTopWidth: 1, borderTopColor: theme.colors.border }]}>
          <Button
            onPress={() => void onSaveOrRecalibrate()}
            variant={frozen ? 'secondary' : 'primary'}
            loading={savingFreeze}
            disabled={confirming || autoAdjusting || (!isDemo && !detectorStatus)}
            testID="calibration-save"
          >
            {frozen ? t(workflowSupported ? 'laserCalibration.prepareTarget' : 'calibration.recalibrate')
              : t(workflowSupported ? 'laserCalibration.lockTarget' : 'calibration.save')}
          </Button>
          {frozen ? <Button
            onPress={() => void onConfirm()}
            loading={confirming}
            disabled={!frozen || savingFreeze || (!isDemo && workflowSupported && !!detectorStatus
              && (detectorStatus.detector.state !== 'ready' || !!detectorStatus.error))}
            testID="calibration-confirm"
          >
            {t('common.next')}
          </Button> : null}
        </View>
    </SafeAreaView>
  );
};

type SectionProps = {
  title: string;
  subtitle?: string;
  onResetSection: () => void;
  children: React.ReactNode;
};

const CalibrationSection = ({
  title,
  subtitle,
  onResetSection,
  children,
}: SectionProps) => {
  const theme = useTheme();
  return (
    <Card>
      <View style={styles.sectionHeader}>
        <View style={{ flex: 1 }}>
          <Text variant="bodyBold">{title}</Text>
          {subtitle ? (
            <Text variant="caption" color="textMuted" style={{ marginTop: 2 }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Button variant="ghost" onPress={onResetSection}>
          <Ionicons name="refresh" size={16} color={theme.colors.text} />
        </Button>
      </View>
      {children}
    </Card>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {},
  scroll: { flex: 1 },
  autoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  autoBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
  },
});
