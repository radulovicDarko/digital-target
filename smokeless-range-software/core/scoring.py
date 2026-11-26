"""v2 deterministic radial scoring (camera-behind-paper box).

The legacy pipeline (``app.py`` + ``core/calibration.py``) detects the black
bull, fits ring ellipses and solves a paper homography every frame to undo the
camera's perspective. That machinery only exists because the camera looks at
the target from an angle. In the v2 box the Camera Module 3 is mounted
square-on and centred behind the paper, so the geometry is fixed and known:

    * the target centre is the image centre (+ a small per-unit offset),
    * per-box perspective/lens correction is optional,
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
    x_norm: float         # 0..1 across the visible paper bounds
    y_norm: float         # 0..1 across the visible paper bounds
    is_inner_ten: bool    # pellet fully inside the inner-ten dot
    max_radius_mm: float  # outer ring-1 radius (for miss / off-paper checks)


@dataclass(frozen=True)
class FixedGeometry:
    """Measured source-pixel correction; shared by scoring and projection."""

    frame_size: tuple[int, int]
    normalization_px: float = 300.0
    shear: float = 0.0
    scale_y: float = 1.0
    perspective_x: float = 0.0
    perspective_y: float = 0.0
    radial_k1: float = 0.0

    def __post_init__(self) -> None:
        if len(self.frame_size) != 2 or any(type(v) is not int or v <= 0 for v in self.frame_size):
            raise ValueError("Fixed geometry needs a positive integer frame_size")
        values = (self.normalization_px, self.shear, self.scale_y,
                  self.perspective_x, self.perspective_y, self.radial_k1)
        if not all(math.isfinite(v) for v in values) or min(self.normalization_px, self.scale_y) <= 0:
            raise ValueError("Invalid fixed perspective/lens correction")

    def correct(self, x: float, y: float) -> tuple[float, float]:
        radius_sq = (x * x + y * y) / self.normalization_px ** 2
        factor = 1 + self.radial_k1 * radius_sq
        if 1 + 3 * self.radial_k1 * radius_sq <= 0:
            raise ValueError("Fixed lens correction is not invertible at this pixel")
        x, y = x * factor, y * factor
        denominator = 1 + (self.perspective_x * x + self.perspective_y * y) / self.normalization_px
        if denominator <= 0:
            raise ValueError("Pixel lies beyond the fixed perspective horizon")
        return (x + self.shear * y) / denominator, self.scale_y * y / denominator

    def uncorrect(self, x: float, y: float) -> tuple[float, float]:
        y /= self.scale_y
        x -= self.shear * y
        denominator = 1 - (self.perspective_x * x + self.perspective_y * y) / self.normalization_px
        if denominator <= 0:
            raise ValueError("Target lies beyond the fixed perspective horizon")
        x, y = x / denominator, y / denominator
        corrected_radius = math.hypot(x, y) / self.normalization_px
        if corrected_radius == 0:
            return 0.0, 0.0
        radius = corrected_radius
        for _ in range(20):
            error = radius * (1 + self.radial_k1 * radius * radius) - corrected_radius
            if abs(error) < 1e-12:
                break
            derivative = 1 + 3 * self.radial_k1 * radius * radius
            if derivative <= 0:
                raise ValueError("Target lies outside the invertible lens correction")
            radius -= error / derivative
            if radius < 0:
                raise ValueError("Invalid inverse lens radius")
        else:
            raise ValueError("Inverse lens correction did not converge")
        factor = radius / corrected_radius
        return x * factor, y * factor


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
    geometry:
        Optional measured perspective/lens correction, valid only at its
        calibrated source dimensions. No correction preserves the old model.
    paper_bounds_mm:
        Optional visible opening (left, top, right, bottom), relative to the
        target centre in shooter orientation. Defaults to a centred square.
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
        geometry: FixedGeometry | None = None,
        paper_bounds_mm: tuple[float, float, float, float] | None = None,
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
        half = self._paper_span_mm / 2
        self.paper_bounds_mm = paper_bounds_mm or (-half, -half, half, half)
        left, top, right, bottom = self.paper_bounds_mm
        if not all(math.isfinite(v) for v in self.paper_bounds_mm) or left >= right or top >= bottom:
            raise ValueError("Visible paper bounds must be finite and ordered")
        self._offset_x_px = float(center_offset_px[0])
        self._offset_y_px = float(center_offset_px[1])
        self._mirror_x = bool(mirror_x)
        self._mirror_y = bool(mirror_y)
        self._max_radius_mm = self._ring_diameters_mm[0] / 2.0
        self._geometry = geometry
        if geometry is not None:
            width, height = geometry.frame_size
            for x, y in ((0, 0), (width, 0), (width, height), (0, height)):
                geometry.correct(x - width / 2 - self._offset_x_px,
                                 y - height / 2 - self._offset_y_px)

    @property
    def max_radius_mm(self) -> float:
        return self._max_radius_mm

    def score(self, x_px, y_px, frame_w, frame_h) -> RadialHit:
        """Score a laser detected at ``(x_px, y_px)`` in a ``frame_w`` × ``frame_h`` image."""
        cx = frame_w / 2.0 + self._offset_x_px
        cy = frame_h / 2.0 + self._offset_y_px

        self._check_frame(frame_w, frame_h)
        dx, dy = x_px - cx, y_px - cy
        if self._geometry is not None:
            dx, dy = self._geometry.correct(dx, dy)
        dx_mm, dy_mm = dx * self._mm_per_px, dy * self._mm_per_px
        return self.score_mm(dx_mm, dy_mm, apply_mirror=True)

    def _check_frame(self, width: int, height: int) -> None:
        if self._geometry is not None and (width, height) != self._geometry.frame_size:
            raise ValueError("Fixed geometry frame dimensions changed; recalibrate the camera")

    def project_mm(self, x_mm: float, y_mm: float, width: int, height: int) -> tuple[float, float]:
        """Project camera-oriented target coordinates into original source pixels."""
        self._check_frame(width, height)
        x, y = x_mm / self._mm_per_px, y_mm / self._mm_per_px
        if self._geometry is not None:
            x, y = self._geometry.uncorrect(x, y)
        return width / 2 + self._offset_x_px + x, height / 2 + self._offset_y_px + y

    def ring_points(self, diameter_mm: float, width: int, height: int) -> list[tuple[float, float]]:
        radius = diameter_mm / 2
        return [
            self.project_mm(radius * math.cos(i * math.tau / 360),
                            radius * math.sin(i * math.tau / 360), width, height)
            for i in range(360)
        ]

    def paper_points(self, width: int, height: int) -> list[tuple[float, float]]:
        left, top, right, bottom = self.paper_bounds_mm
        corners = ((left, top), (right, top), (right, bottom), (left, bottom))
        points = []
        for edge in range(4):
            x1, y1 = corners[edge]
            x2, y2 = corners[(edge + 1) % 4]
            for i in range(32):
                x = x1 + (x2 - x1) * i / 32
                y = y1 + (y2 - y1) * i / 32
                points.append(self.project_mm(-x if self._mirror_x else x,
                                              -y if self._mirror_y else y, width, height))
        return points

    def detection_roi(self, width: int, height: int) -> tuple[int, int, int, int]:
        points = self.paper_points(width, height)
        x1 = max(0, int(min(p[0] for p in points)))
        y1 = max(0, int(min(p[1] for p in points)))
        x2 = min(width, math.ceil(max(p[0] for p in points)) + 1)
        y2 = min(height, math.ceil(max(p[1] for p in points)) + 1)
        if x2 <= x1 or y2 <= y1:
            raise ValueError("Fixed target ROI lies outside the camera frame")
        return x1, y1, x2 - x1, y2 - y1

    def on_paper(self, x_mm: float, y_mm: float) -> bool:
        left, top, right, bottom = self.paper_bounds_mm
        return left <= x_mm <= right and top <= y_mm <= bottom

    def score_mm(self, dx_mm: float, dy_mm: float, *, apply_mirror: bool = False) -> RadialHit:
        """Score centred world coordinates; homography already defines orientation."""
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
        disp_x_mm = -dx_mm if apply_mirror and self._mirror_x else dx_mm
        disp_y_mm = -dy_mm if apply_mirror and self._mirror_y else dy_mm

        left, top, right, bottom = self.paper_bounds_mm
        x_norm = _clamp01((disp_x_mm - left) / (right - left))
        y_norm = _clamp01((disp_y_mm - top) / (bottom - top))

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
