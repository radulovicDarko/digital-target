import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApiClient } from '@/api/hooks';
import { DEMO_LOCAL_BASE_URL, isDemoPairing } from '@/api/demo';
import { Button, Card, ScreenHeader, Slider, Text } from '@/components';
import { usePairingStore } from '@/state/pairingStore';
import { logger } from '@/storage/logger';
import { securePairings } from '@/storage/securePairings';
import { useTheme } from '@/theme';

import { LivePreview } from './LivePreview';

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
  const [frozen, setFrozen] = useState(false);
  const [tweaks, setTweaks] = useState<Tweaks>(DEFAULT_TWEAKS);

  const isDemo = isDemoPairing(active);
  const previewBaseUrl = isDemo ? DEMO_LOCAL_BASE_URL : active?.baseUrl;

  // Latest-write-wins POST queue. Refs so a re-render mid-drag doesn't
  // cancel the outgoing request.
  const pendingTweaks = useRef<Tweaks | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  const flushTweaks = useCallback(async () => {
    if (!previewBaseUrl) return;
    if (inFlight.current) return; // a flush will trigger again on completion
    const next = pendingTweaks.current;
    if (next == null) return;
    pendingTweaks.current = null;
    inFlight.current = true;
    try {
      await fetch(`${previewBaseUrl}/api/calibration/tweaks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
    } catch (e) {
      void logger.warn('cal', `tweaks update failed: ${String(e)}`);
    } finally {
      inFlight.current = false;
      // If another change arrived while we were flushing, send the latest.
      if (pendingTweaks.current != null) void flushTweaks();
    }
  }, [previewBaseUrl]);

  // Apply tweak locally instantly (no flicker), debounce the network write.
  const applyTweaks = useCallback(
    (patch: Partial<Tweaks>) => {
      setTweaks((prev) => {
        const merged = { ...prev, ...patch };
        pendingTweaks.current = merged;
        if (flushTimer.current) clearTimeout(flushTimer.current);
        flushTimer.current = setTimeout(() => {
          flushTimer.current = null;
          void flushTweaks();
        }, TWEAK_DEBOUNCE_MS);
        return merged;
      });
    },
    [flushTweaks],
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
    if (raw?.post) await raw.post(path);
  };

  const onSaveOrRecalibrate = async () => {
    setSavingFreeze(true);
    try {
      if (frozen) {
        await postControl('/api/calibration/unfreeze');
        setFrozen(false);
      } else {
        await postControl('/api/calibration/freeze');
        setFrozen(true);
        Alert.alert(t('calibration.savedTitle'), t('calibration.savedBody'));
      }
    } catch (e) {
      void logger.warn('cal', `freeze toggle failed: ${String(e)}`);
      Alert.alert(t('common.error'), t('errors.network'));
    } finally {
      setSavingFreeze(false);
    }
  };

  const onConfirm = async () => {
    setConfirming(true);
    try {
      // In headless Pi setups there is no keyboard 'n' to freeze alignment.
      // Freeze via HTTP so the detector starts emitting hits reliably once
      // the user confirms calibration.
      await postControl('/api/calibration/freeze');
      const updated = { ...active, calibrationConfirmedAt: Date.now() };
      await securePairings.upsert(updated);
      upsert(updated);
      setActive(updated);
      onCompleted();
    } catch (e) {
      void logger.warn('cal', `confirm failed: ${String(e)}`);
      Alert.alert(t('common.error'), t('errors.network'));
    } finally {
      setConfirming(false);
    }
  };

  const onBack = () => {
    Alert.alert(
      'Leave calibration?',
      'Calibration is required before you can use this Range. You can resume later from Settings.',
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: 'Leave',
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
      edges={['top', 'left', 'right']}
      style={[styles.root, { backgroundColor: theme.colors.bg }]}
      testID="calibration"
    >
      {/* Fixed header: title + live preview always visible. */}
      <View style={[styles.header, { paddingHorizontal: theme.spacing(4), paddingTop: theme.spacing(2), paddingBottom: theme.spacing(4) }]}>
        <ScreenHeader
          title={t('calibration.title')}
          subtitle={t('calibration.subtitle', { name: active.name })}
          onBack={onBack}
          backLabel="Leave calibration"
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
        <Card>
          <View style={styles.autoRow}>
            <Button
              onPress={() => void onAutoAdjust()}
              loading={autoAdjusting}
              variant="primary"
            >
              <View style={styles.autoBtnContent}>
                <Ionicons name="sparkles" size={16} color={theme.colors.textInverse} />
                <Text color="textInverse" variant="bodyBold">
                  {' '}Auto adjust
                </Text>
              </View>
            </Button>
            <Button variant="secondary" onPress={onLockHorizontal}>
              Lock horizontal
            </Button>
            <Button variant="ghost" onPress={() => applyTweaks(DEFAULT_TWEAKS)}>
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

        <Card>
          <Text variant="bodyBold">{t('calibration.checklistTitle')}</Text>
          <ChecklistItem text={t('calibration.checklist1')} />
          <ChecklistItem text={t('calibration.checklist2')} />
          <ChecklistItem text={t('calibration.checklist3')} />
        </Card>

        <View style={styles.actionRow}>
          <Button
            onPress={() => void onSaveOrRecalibrate()}
            variant={frozen ? 'primary' : 'secondary'}
            loading={savingFreeze}
            testID="calibration-save"
          >
            {frozen ? t('calibration.recalibrate') : t('calibration.save')}
          </Button>
          <Button
            onPress={() => void onConfirm()}
            loading={confirming}
            disabled={!frozen}
            testID="calibration-confirm"
          >
            {t('calibration.confirm')}
          </Button>
        </View>
      </ScrollView>
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

const ChecklistItem = ({ text }: { text: string }) => {
  const t = useTheme();
  return (
    <View style={[styles.checkRow, { marginTop: t.spacing(2) }]}>
      <Ionicons name="checkmark-circle-outline" size={18} color={t.colors.success} />
      <Text style={{ flex: 1 }}>{text}</Text>
    </View>
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
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
});
