"""v2 deterministic radial scoring (camera-behind-paper box).

The legacy pipeline (``app.py`` + ``core/calibration.py``) detects the black
bull, fits ring ellipses and solves a paper homography every frame to undo the
camera's perspective. That machinery only exists because the camera looks at
the target from an angle. In the v2 box the Camera Module 3 is mounted
square-on and centred behind the paper, so the geometry is fixed and known:

    * the target centre is the image centre (+ a small per-unit offset),
    * one millimetre spans a constant number of pixels (``mm_per_px``),
    * scoring is a pure function of radial distance from that centre.

``RadialScorer`` turns a detected laser pixel into a fully-scored hit using the
same pellet-edge rule as the legacy ``score_for_hit``, so a shot that clips a
ring line scores the higher ring exactly as on a real target.

This module has NO OpenCV / NumPy dependency and is unit-testable in isolation.
The legacy code is left completely untouched; selection between the two paths is
done by ``SCORING_MODE`` in ``config.py``.
"""
from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class RadialHit:
    """Result of scoring one laser detection in the fixed-center model."""

    ring: int             # 0 (miss) .. number of rings
    score: int            # identical to ``ring`` for this face (0..10)
    dist_mm: float        # radial distance of the laser CENTRE from target centre
    x_mm: float           # centred, display-oriented (mirror applied), +x = right
    y_mm: float           # centred, display-oriented, +y = down
    x_norm: float         # 0..1 across the reported paper span (0.5 = centre)
    y_norm: float         # 0..1 across the reported paper span (0.5 = centre)
    is_inner_ten: bool    # pellet fully inside the inner-ten dot
    max_radius_mm: float  # outer ring-1 radius (for miss / off-paper checks)


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


class RadialScorer:
    """Deterministic radial scorer for the camera-behind-paper box.

    Parameters
    ----------
    ring_diameters_mm:
        Ring diameters in mm, OUTER first (index 0 = ring 1) to INNER last
        (index ``N-1`` = highest ring). Must be non-empty.
    inner_ten_mm:
        Diameter of the inner-ten dot in mm.
    pellet_mm:
        Diabolo diameter in mm; a virtual disc of this size is placed around
        the laser centre and the pellet-edge rule is applied.
    mm_per_px:
        Millimetres spanned by one pixel at the paper plane. Must be > 0.
    paper_span_mm:
        Paper width reported to the app; used only to normalise
        ``x_norm``/``y_norm`` into 0..1 for the WS schema. Must be > 0.
    center_offset_px:
        ``(dx, dy)`` added to the image centre, in pixels.
    mirror_x, mirror_y:
        Flip the respective display axis (the camera is behind the paper, so
        the horizontal axis is mirrored by default).
    """

    def __init__(
        self,
        ring_diameters_mm,
        inner_ten_mm,
        pellet_mm,
        mm_per_px,
        paper_span_mm,
        center_offset_px=(0.0, 0.0),
        mirror_x=True,
        mirror_y=False,
    ):
        self._ring_diameters_mm = tuple(float(d) for d in ring_diameters_mm)
        if not self._ring_diameters_mm:
            raise ValueError("ring_diameters_mm must not be empty")
        if mm_per_px <= 0:
            raise ValueError("mm_per_px must be positive")
        if paper_span_mm <= 0:
            raise ValueError("paper_span_mm must be positive")
        self._inner_ten_mm = float(inner_ten_mm)
        self._pellet_r_mm = float(pellet_mm) / 2.0
        self._mm_per_px = float(mm_per_px)
        self._paper_span_mm = float(paper_span_mm)
        self._offset_x_px = float(center_offset_px[0])
        self._offset_y_px = float(center_offset_px[1])
        self._mirror_x = bool(mirror_x)
        self._mirror_y = bool(mirror_y)
        self._max_radius_mm = self._ring_diameters_mm[0] / 2.0

    @property
    def max_radius_mm(self) -> float:
        return self._max_radius_mm

    def score(self, x_px, y_px, frame_w, frame_h) -> RadialHit:
        """Score a laser detected at ``(x_px, y_px)`` in a ``frame_w`` × ``frame_h`` image."""
        cx = frame_w / 2.0 + self._offset_x_px
        cy = frame_h / 2.0 + self._offset_y_px

        # Signed offset from centre, in mm, in CAMERA orientation.
        dx_mm = (x_px - cx) * self._mm_per_px
        dy_mm = (y_px - cy) * self._mm_per_px
        dist_mm = math.hypot(dx_mm, dy_mm)

        # Pellet-edge rule: a shot counts for ring R if the pellet EDGE reaches
        # the ring, i.e. dist - pellet_radius <= ring_radius. Highest ring wins.
        best = 0
        for idx, diam in enumerate(self._ring_diameters_mm):
            if dist_mm - self._pellet_r_mm <= diam / 2.0:
                best = idx + 1
        ring = best
        score = best
        highest = len(self._ring_diameters_mm)
        is_inner_ten = (
            ring == highest
            and (dist_mm + self._pellet_r_mm) <= (self._inner_ten_mm / 2.0)
        )

        # Display orientation: undo the behind-the-paper mirror so the plotted
        # hit matches what the shooter sees on the front of the target.
        disp_x_mm = -dx_mm if self._mirror_x else dx_mm
        disp_y_mm = -dy_mm if self._mirror_y else dy_mm

        x_norm = _clamp01(0.5 + disp_x_mm / self._paper_span_mm)
        y_norm = _clamp01(0.5 + disp_y_mm / self._paper_span_mm)

        return RadialHit(
            ring=ring,
            score=score,
            dist_mm=dist_mm,
            x_mm=disp_x_mm,
            y_mm=disp_y_mm,
            x_norm=x_norm,
            y_norm=y_norm,
            is_inner_ten=is_inner_ten,
            max_radius_mm=self._max_radius_mm,
        )
