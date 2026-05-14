import { Canvas, Circle, Group, Path, Rect, Skia, vec } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';

import { useTheme } from '@/theme';
import type { Hit, TargetConfig } from '@/types/session';

import { computeMpi, computeGroupExtents } from './geometry';

type Props = {
  size: number;
  config: TargetConfig;
  hits: Hit[];
  showMpi?: boolean;
  showGroupEllipse?: boolean;
  /** Timestamp of the hit to highlight with a focus halo. */
  highlightTs?: number | null;
};

// ISSF target colours (paper, black bull) — chosen to read like the photo
// from the Python detector window.
const PAPER_COLOR = '#F1E9D6';
const BULL_COLOR = '#0E0E0E';
const BLACK_LINE = '#0E0E0E';
const WHITE_LINE = '#F1E9D6';

/**
 * Realistic ISSF 10m air pistol target. Renders the paper, the filled black
 * bull (rings 7–10), white ring strokes inside the bull and black ring
 * strokes outside, ring number labels, the inner-X dot, optional analytics
 * (group ellipse + MPI), and all hits scaled at the same mm-per-px ratio
 * the Python detector uses — so a pellet that clips a line on the Pi clips
 * the same line here.
 */
export const LiveTargetCanvas = ({
  size,
  config,
  hits,
  showMpi = false,
  showGroupEllipse = false,
  highlightTs = null,
}: Props) => {
  const theme = useTheme();

  // Sort outer→inner so we always know the index of each ring regardless of
  // which order the server sends them in. After sorting, index 0 = ring 1
  // (outermost) … index 9 = ring 10 (innermost).
  const ringsOuterToInner = useMemo(
    () => [...config.ringDiametersMm].sort((a, b) => b - a),
    [config.ringDiametersMm],
  );

  // Reference diameter = the ISSF paper edge (170 mm for 10 m air pistol).
  // The paper is what the camera frames, so scaling to it gives a true 1:1
  // visual match with the Python detector view.
  const referenceMm = config.paperMm > 0 ? config.paperMm : ringsOuterToInner[0] ?? 1;
  const scaleMmToPx = useMemo(() => (size * 0.98) / referenceMm, [size, referenceMm]);

  const half = size / 2;
  const px = (mm: number) => half + mm * scaleMmToPx;

  // The cream paper itself — square, sized to paperMm.
  const paperSidePx = referenceMm * scaleMmToPx;
  const paperX = half - paperSidePx / 2;
  const paperY = half - paperSidePx / 2;

  // Bull = circle filled to ring 7's outer edge. With 10 rings, ring 7's
  // outer edge is index 6 in the sorted array.
  const bullDiameterMm = ringsOuterToInner[6] ?? 59.5;
  const bullRadiusPx = (bullDiameterMm * scaleMmToPx) / 2;

  // Outer rings (1–6) drawn black on paper.
  const outerRingsPath = useMemo(() => {
    const path = Skia.Path.Make();
    ringsOuterToInner.slice(0, 6).forEach((d) => {
      path.addCircle(half, half, (d * scaleMmToPx) / 2);
    });
    return path;
  }, [ringsOuterToInner, half, scaleMmToPx]);

  // Inner rings (7–10) drawn white on top of the black bull. Ring 7's edge
  // is also drawn so the bull boundary itself reads as a defined line.
  const innerRingsPath = useMemo(() => {
    const path = Skia.Path.Make();
    ringsOuterToInner.slice(6).forEach((d) => {
      path.addCircle(half, half, (d * scaleMmToPx) / 2);
    });
    return path;
  }, [ringsOuterToInner, half, scaleMmToPx]);

  const innerTenRadiusPx = (config.innerTenMm * scaleMmToPx) / 2;
  const hitRadiusPx = Math.max(2, (config.pelletMm * scaleMmToPx) / 2);

  const mpi = useMemo(() => (showMpi ? computeMpi(hits) : null), [hits, showMpi]);
  const ellipse = useMemo(
    () => (showGroupEllipse ? computeGroupExtents(hits) : null),
    [hits, showGroupEllipse],
  );

  // Compute number-label positions: number for ring N sits halfway between
  // ring N's outer edge and ring (N+1)'s outer edge, on the horizontal axis,
  // both left and right. ISSF prints labels for rings 1 through 9.
  const labels = useMemo(() => {
    const out: { ring: number; rPx: number; color: string }[] = [];
    for (let n = 1; n <= 9; n += 1) {
      const dOuter = ringsOuterToInner[n - 1];
      const dInner = ringsOuterToInner[n] ?? 0;
      if (dOuter == null) continue;
      const rMidMm = (dOuter / 2 + dInner / 2) / 2;
      // Numbers 1–6 sit on white paper (black ink), 7–9 sit on the black
      // bull (white ink). Ring boundary == bull boundary == ring 7.
      const onBull = n >= 7;
      out.push({
        ring: n,
        rPx: rMidMm * scaleMmToPx,
        color: onBull ? WHITE_LINE : BLACK_LINE,
      });
    }
    return out;
  }, [ringsOuterToInner, scaleMmToPx]);

  return (
    <View style={{ width: size, height: size }}>
      <Canvas style={StyleSheet.absoluteFillObject}>
        <Group>
          {/* Square cream paper backdrop (real ISSF 170×170 mm sheet). */}
          <Rect
            x={paperX}
            y={paperY}
            width={paperSidePx}
            height={paperSidePx}
            color={PAPER_COLOR}
          />

          {/* Black bull (filled to ring 7 outer edge). */}
          <Circle cx={half} cy={half} r={bullRadiusPx} color={BULL_COLOR} />

          {/* Outer rings 1–6 in black on paper. */}
          <Path
            path={outerRingsPath}
            style="stroke"
            strokeWidth={1.2}
            color={BLACK_LINE}
          />

          {/* Inner rings 7–10 in white on bull. */}
          <Path
            path={innerRingsPath}
            style="stroke"
            strokeWidth={1.2}
            color={WHITE_LINE}
          />

          {/* Inner-X dot (the small central highlight). */}
          <Circle
            cx={half}
            cy={half}
            r={innerTenRadiusPx}
            color={WHITE_LINE}
            style="stroke"
            strokeWidth={1}
          />
          <Circle cx={half} cy={half} r={1.5} color={WHITE_LINE} />

          {ellipse ? (
            <Path
              path={Skia.Path.Make().addOval({
                x: px(ellipse.minXMm),
                y: px(ellipse.minYMm),
                width: px(ellipse.maxXMm) - px(ellipse.minXMm),
                height: px(ellipse.maxYMm) - px(ellipse.minYMm),
              })}
              style="stroke"
              strokeWidth={1}
              color={theme.colors.info}
            />
          ) : null}

          {mpi ? (
            <Group
              transform={[{ translateX: px(mpi.x) - half }, { translateY: px(mpi.y) - half }]}
            >
              <Circle cx={half} cy={half} r={4} color={theme.colors.warning} />
            </Group>
          ) : null}

          {/* Hits — same mm scale as Python, so a pellet that clips a line
              on the Pi clips the same line here. Drawn last so they appear
              on top of the rings. The focused hit is held back and drawn
              afterwards inside its halo group. */}
          {hits.map((h, i) => {
            if (highlightTs !== null && h.ts === highlightTs) return null;
            const cx = px(h.xMm);
            const cy = px(h.yMm);
            const color = theme.colors.ringPalette[h.ring] ?? theme.colors.text;
            return (
              <Group key={`${h.ts}-${i}`}>
                {/* subtle outline so dark hits remain visible on the bull */}
                <Circle
                  cx={cx}
                  cy={cy}
                  r={hitRadiusPx}
                  color="#FFFFFF"
                  style="stroke"
                  strokeWidth={0.8}
                />
                <Circle cx={cx} cy={cy} r={hitRadiusPx} color={color} origin={vec(cx, cy)} />
              </Group>
            );
          })}

          {highlightTs !== null
            ? (() => {
                const focused = hits.find((h) => h.ts === highlightTs);
                if (!focused) return null;
                const cx = px(focused.xMm);
                const cy = px(focused.yMm);
                const color = theme.colors.ringPalette[focused.ring] ?? theme.colors.text;
                return (
                  <Group key={`focus-${focused.ts}`}>
                    <Circle
                      cx={cx}
                      cy={cy}
                      r={hitRadiusPx * 3}
                      color={theme.colors.primary}
                      opacity={0.18}
                    />
                    <Circle
                      cx={cx}
                      cy={cy}
                      r={hitRadiusPx * 2}
                      color={theme.colors.primary}
                      style="stroke"
                      strokeWidth={2}
                    />
                    <Circle
                      cx={cx}
                      cy={cy}
                      r={hitRadiusPx}
                      color="#FFFFFF"
                      style="stroke"
                      strokeWidth={0.8}
                    />
                    <Circle cx={cx} cy={cy} r={hitRadiusPx} color={color} origin={vec(cx, cy)} />
                  </Group>
                );
              })()
            : null}
        </Group>
      </Canvas>

      {/* Ring number labels (1–9) — overlaid as native Text so we don't need
          to load a font into Skia. Numbers appear on left, right, top, and
          bottom of the bull at the midpoint between consecutive ring edges,
          like a real ISSF target. Each label is centered exactly on its
          radial position so it sits in the gap between two rings. */}
      {labels.map((l) => {
        const fontSize = Math.max(8, Math.min(14, size / 32));
        const labelBox = Math.max(20, fontSize * 1.6);
        const labelStyle = {
          color: l.color,
          fontSize,
          fontWeight: '600' as const,
          lineHeight: fontSize * 1.05,
        };
        // Centred on (half ± rPx, half) for left/right; (half, half ± rPx)
        // for top/bottom. Subtract half the box dimensions so the visual
        // centre of the digit lands exactly on the radial position.
        const positions = [
          { left: half - l.rPx - labelBox / 2, top: half - labelBox / 2 }, // W
          { left: half + l.rPx - labelBox / 2, top: half - labelBox / 2 }, // E
          { left: half - labelBox / 2, top: half - l.rPx - labelBox / 2 }, // N
          { left: half - labelBox / 2, top: half + l.rPx - labelBox / 2 }, // S
        ];
        return (
          <View key={`labels-${l.ring}`} pointerEvents="none">
            {positions.map((pos, i) => (
              <RNText
                key={`label-${l.ring}-${i}`}
                style={[
                  styles.label,
                  labelStyle,
                  { width: labelBox, height: labelBox, lineHeight: labelBox },
                  pos,
                ]}
                accessible={false}
              >
                {l.ring}
              </RNText>
            ))}
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  label: {
    position: 'absolute',
    textAlign: 'center',
  },
});
