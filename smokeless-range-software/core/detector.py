from __future__ import annotations

from dataclasses import dataclass
import math
from typing import TypedDict

import cv2
import numpy as np


class Detection(TypedDict):
    x: float
    y: float
    area: int
    nx: float
    ny: float


@dataclass(frozen=True)
class DetectorSettings:
    min_area: int = 8
    max_area: int = 2500
    min_circularity: float = 0.35
    min_diff: int = 20
    background_alpha: float = 0.005
    confirmation_frames: int = 2
    confirmation_radius_px: float = 15.0
    cooldown_frames: int = 8
    clear_frames: int = 2
    warmup_frames: int = 5
    instability_fraction: float = 0.30
    blur_size: int = 5
    morph_kernel_size: int = 3
    opening_iterations: int = 1
    closing_iterations: int = 2
    red_validation_enabled: bool = True
    red_margin: int = 30
    saturation_level: int = 235
    gaussian_refinement_enabled: bool = True
    gaussian_max_error: float = 0.35
    gaussian_max_shift_px: float = 5.0

    def __post_init__(self) -> None:
        integers = (
            self.min_area, self.max_area, self.min_diff, self.confirmation_frames,
            self.cooldown_frames, self.clear_frames, self.warmup_frames,
            self.blur_size, self.morph_kernel_size, self.opening_iterations, self.closing_iterations,
            self.red_margin, self.saturation_level,
        )
        if any(type(value) is not int for value in integers):
            raise ValueError("Detector frame counts, sizes and thresholds must be integers")
        if not 0 < self.min_area <= self.max_area:
            raise ValueError("Detector area bounds must be positive and ordered")
        if not 0 < self.min_diff <= 255 or not 0 <= self.red_margin <= 255:
            raise ValueError("Detector brightness/color thresholds must be in byte range")
        if not 0 < self.saturation_level <= 255:
            raise ValueError("saturation_level must be in 1..255")
        if min(self.confirmation_frames, self.clear_frames, self.warmup_frames) < 1:
            raise ValueError("Confirmation, clear and warmup counts must be positive")
        if min(self.cooldown_frames, self.opening_iterations, self.closing_iterations) < 0:
            raise ValueError("Cooldown/morphology counts must not be negative")
        if self.blur_size < 1 or self.blur_size % 2 != 1:
            raise ValueError("blur_size must be a positive odd number")
        if self.morph_kernel_size < 1 or self.morph_kernel_size % 2 != 1:
            raise ValueError("morph_kernel_size must be a positive odd number")
        if not 0 < self.background_alpha <= 1 or not 0 < self.instability_fraction <= 1:
            raise ValueError("Background alpha and instability fraction must be in (0, 1]")
        if not 0 <= self.min_circularity <= 1:
            raise ValueError("min_circularity must be in [0, 1]")
        floats = (
            self.background_alpha, self.instability_fraction, self.min_circularity,
            self.confirmation_radius_px, self.gaussian_max_error, self.gaussian_max_shift_px,
        )
        if not all(math.isfinite(value) for value in floats):
            raise ValueError("Detector settings must be finite")
        if min(self.confirmation_radius_px, self.gaussian_max_error, self.gaussian_max_shift_px) <= 0:
            raise ValueError("Detector position/refinement tolerances must be positive")
        if type(self.red_validation_enabled) is not bool or type(self.gaussian_refinement_enabled) is not bool:
            raise ValueError("Detector validation/refinement flags must be booleans")


class LaserDetector:
    """Temporal candidates stay separate from committed, scored shots."""

    def __init__(self, settings: DetectorSettings | None = None) -> None:
        self.settings = settings or DetectorSettings()
        self.kernel = np.ones((self.settings.morph_kernel_size, self.settings.morph_kernel_size), np.uint8)
        self.debug = False
        self.background: np.ndarray | None = None
        self._geometry: tuple[object, ...] | None = None
        self._previous: np.ndarray | None = None
        self.reset("startup")

    def reset(self, reason: str = "operator") -> None:
        self.background = None
        self._previous = None
        self._warmup = 0
        self._count = 0
        self._position: tuple[float, float] | None = None
        self._cooldown = 0
        self._clear = 0
        self._confirmed = False
        self.armed = True
        self.state = "warming"
        self.reason = reason
        self.scene_changed = False
        self.rejected: list[dict[str, object]] = []
        self.refinement = "weighted"
        self.diff = np.zeros((1, 1), np.uint8)
        self.threshold_mask = self.diff.copy()
        self.mask = self.diff.copy()
        self.contours: list[np.ndarray] = []
        self.center: tuple[float, float] | None = None

    def status(self) -> dict[str, object]:
        return {
            "state": self.state, "reason": self.reason, "confirmation": self._count,
            "cooldown": self._cooldown, "armed": self.armed,
            "refinement": self.refinement, "rejected": self.rejected,
        }

    def _centroid(self, excess: np.ndarray, gray: np.ndarray) -> tuple[float, float]:
        yy, xx = np.indices(excess.shape, dtype=np.float64)
        total = float(excess.sum())
        cx = float((xx * excess).sum() / total)
        cy = float((yy * excess).sum() / total)
        self.refinement = "weighted"
        if not self.settings.gaussian_refinement_enabled:
            return cx, cy
        valid = (excess > float(excess.max()) * 0.15) & (gray < self.settings.saturation_level)
        if np.count_nonzero(valid) < 9:
            self.refinement = "weighted: saturated/insufficient samples"
            return cx, cy
        x, y = xx[valid] - cx, yy[valid] - cy
        design = np.column_stack((x * x, x * y, y * y, x, y, np.ones_like(x)))
        log_intensity = np.log(excess[valid])
        coeff, _, rank, _ = np.linalg.lstsq(design, log_intensity, rcond=None)
        hessian = np.array([[2 * coeff[0], coeff[1]], [coeff[1], 2 * coeff[2]]])
        residual = float(np.sqrt(np.mean((design @ coeff - log_intensity) ** 2)))
        if rank < 6 or np.any(np.linalg.eigvalsh(hessian) >= -1e-6):
            self.refinement = "weighted: non-Gaussian shape"
            return cx, cy
        shift = -np.linalg.solve(hessian, coeff[3:5])
        refined_x, refined_y = cx + float(shift[0]), cy + float(shift[1])
        if (
            residual > self.settings.gaussian_max_error
            or float(np.linalg.norm(shift)) > self.settings.gaussian_max_shift_px
            or not 0 <= refined_x < excess.shape[1]
            or not 0 <= refined_y < excess.shape[0]
        ):
            self.refinement = "weighted: Gaussian fit outside tolerance"
            return cx, cy
        self.refinement = "gaussian"
        return refined_x, refined_y

    def detect(
        self,
        frame: np.ndarray,
        roi: tuple[int, int, int, int] | None = None,
        allowed_mask: np.ndarray | None = None,
    ) -> tuple[Detection | None, np.ndarray]:
        if frame.dtype != np.uint8 or frame.ndim != 3 or frame.shape[2] != 3:
            raise ValueError("Detector requires a uint8 BGR frame")
        height, width = frame.shape[:2]
        x0, y0, rw, rh = roi or (0, 0, width, height)
        if (
            any(type(value) is not int for value in (x0, y0, rw, rh))
            or min(x0, y0) < 0 or min(rw, rh) < 1
            or x0 + rw > width or y0 + rh > height
        ):
            raise ValueError("Detector ROI must be a nonempty rectangle inside the frame")
        if allowed_mask is not None and (
            allowed_mask.shape != (rh, rw) or allowed_mask.dtype != np.uint8
        ):
            raise ValueError("Allowed mask must match the uint8 ROI dimensions")
        geometry = (height, width, x0, y0, rw, rh)
        mask_changed = (
            allowed_mask is not None
            and (not hasattr(self, "_allowed") or self._allowed is None
                 or not np.array_equal(allowed_mask, self._allowed))
        ) or (allowed_mask is None and getattr(self, "_allowed", None) is not None)
        if geometry != self._geometry or mask_changed:
            self.reset("geometry")
            self._geometry = geometry
            self._allowed = None if allowed_mask is None else allowed_mask.copy()
        bgr = frame[y0:y0 + rh, x0:x0 + rw]
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (self.settings.blur_size, self.settings.blur_size), 0)
        allowed = np.ones((rh, rw), bool) if allowed_mask is None else allowed_mask != 0
        if not np.any(allowed):
            raise ValueError("Detector allowed target mask is empty")
        self.scene_changed = False
        self.rejected = []
        self.contours = []
        self.center = None
        self._confirmed = False
        self._cooldown = max(0, self._cooldown - 1)
        empty = np.zeros((rh, rw), np.uint8)
        if self.background is None:
            self.background = gray.astype(np.float32)
            self._previous = gray.copy()
            self._warmup = 1
            self.diff = empty
            self.threshold_mask = empty.copy()
            self.mask = empty.copy()
            return None, self.mask
        absolute = cv2.absdiff(gray, cv2.convertScaleAbs(self.background))
        unstable = float(np.mean(absolute[allowed] >= self.settings.min_diff))
        if unstable > self.settings.instability_fraction:
            self.reset("scene_unstable")
            self.scene_changed = True
            self.background = gray.astype(np.float32)
            self._previous = gray.copy()
            self.diff = empty
            self.threshold_mask = empty.copy()
            self.mask = empty.copy()
            return None, self.mask
        if self._warmup < self.settings.warmup_frames:
            self._warmup += 1
            cv2.accumulateWeighted(gray, self.background, self.settings.background_alpha)
            self._previous = gray.copy()
            self.diff = empty
            self.threshold_mask = empty.copy()
            self.mask = empty.copy()
            return None, self.mask
        self.diff = cv2.subtract(gray, cv2.convertScaleAbs(self.background))
        self.diff[~allowed] = 0
        _, threshold = cv2.threshold(self.diff, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        threshold[self.diff < self.settings.min_diff] = 0
        self.threshold_mask = threshold
        self.mask = cv2.morphologyEx(
            threshold, cv2.MORPH_OPEN, self.kernel, iterations=self.settings.opening_iterations,
        )
        self.mask = cv2.morphologyEx(
            self.mask, cv2.MORPH_CLOSE, self.kernel, iterations=self.settings.closing_iterations,
        )
        self.mask[~allowed] = 0
        count, labels, stats, _ = cv2.connectedComponentsWithStats(self.mask, 8)
        candidates: list[Detection] = []
        for index in range(1, count):
            area = int(stats[index, cv2.CC_STAT_AREA])
            component = (labels == index).astype(np.uint8) * 255
            contours, _ = cv2.findContours(component, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            contour = max(contours, key=cv2.contourArea)
            self.contours.append(contour)
            perimeter = cv2.arcLength(contour, True)
            circularity = 4 * math.pi * cv2.contourArea(contour) / max(perimeter ** 2, 1e-6)
            reason = None
            if not self.settings.min_area <= area <= self.settings.max_area:
                reason = "area"
            elif circularity < self.settings.min_circularity:
                reason = "circularity"
            elif self.settings.red_validation_enabled:
                pixels = bgr[labels == index].astype(np.int16)
                blue, green, red = pixels[:, 0], pixels[:, 1], pixels[:, 2]
                red_like = (red > green + self.settings.red_margin) & (red > blue + self.settings.red_margin)
                white = np.all(pixels >= self.settings.saturation_level, axis=1)
                if not np.any(red_like | white):
                    reason = "not_red_or_saturated"
            bx, by, bw, bh, _ = stats[index]
            if reason is not None:
                self.rejected.append({"x": int(bx) + x0, "y": int(by) + y0, "area": area, "reason": reason})
                continue
            excess = self.diff[by:by + bh, bx:bx + bw].astype(np.float64)
            excess[labels[by:by + bh, bx:bx + bw] != index] = 0
            cx, cy = self._centroid(excess, gray[by:by + bh, bx:bx + bw])
            cx, cy = cx + bx + x0, cy + by + y0
            candidates.append({"x": cx, "y": cy, "area": area, "nx": cx / width, "ny": cy / height})
        if len(candidates) != 1:
            self._count = 0
            self._position = None
            if not np.any(threshold):
                self._clear += 1
                if not self._cooldown and self._clear >= self.settings.clear_frames:
                    self.armed = True
                    cv2.accumulateWeighted(gray, self.background, self.settings.background_alpha)
                self.state = "cooldown" if self._cooldown else "ready"
                self.reason = "quiet"
            else:
                self._clear = 0
                self.state = "rejected"
                self.reason = "multiple_candidates" if len(candidates) > 1 else "filtered"
            return None, self.mask
        self._clear = 0
        detection = candidates[0]
        self.center = (detection["x"], detection["y"])
        if not self.armed or self._cooldown:
            self.state = "cooldown" if self._cooldown else "waiting_clear"
            self.reason = "already_registered"
            self._count = 0
            return None, self.mask
        position = self.center
        if self._position is not None and math.dist(position, self._position) <= self.settings.confirmation_radius_px:
            self._count += 1
        else:
            self._count = 1
        self._position = position
        self._confirmed = self._count >= self.settings.confirmation_frames
        self.state = "confirmed" if self._confirmed else "confirming"
        self.reason = "candidate"
        return detection if self._confirmed else None, self.mask

    def should_emit_shot(self) -> bool:
        """Commit only after the application has accepted mapping and scoring."""
        if not self._confirmed or not self.armed or self._cooldown:
            return False
        self.armed = False
        self._cooldown = self.settings.cooldown_frames
        self._confirmed = False
        self.state = "cooldown"
        self.reason = "registered"
        return True
