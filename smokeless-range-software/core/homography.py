from __future__ import annotations

import json
import math
import os
import time
from pathlib import Path

import cv2
import numpy as np


class TargetCalibration:
    def __init__(
        self, path: str, target_points: tuple[tuple[float, float], ...],
        target_size: tuple[float, float], center: tuple[float, float],
        mode: str = "fixed_center", dictionary: str = "DICT_4X4_50",
        marker_points: dict[int, tuple[float, float]] | None = None,
        ransac_mm: float = 5.0, max_error_px: float = 3.0,
    ) -> None:
        self.path = Path(path)
        self.target_points = target_points
        self.target_size = target_size
        self.center = center
        self.mode = mode
        self.dictionary = dictionary
        self.marker_points = marker_points or {}
        self.ransac_mm = ransac_mm
        self.max_error_px = max_error_px
        if mode not in ("fixed_center", "legacy", "homography"):
            raise ValueError("Unknown target mapping mode")
        values = (*target_size, *center, ransac_mm, max_error_px)
        if not all(math.isfinite(value) for value in values) or min(*target_size, ransac_mm, max_error_px) <= 0:
            raise ValueError("Target dimensions and calibration tolerances must be finite and positive")
        self.frame_size: tuple[int, int] | None = None
        self.roi: tuple[int, int, int, int] | None = None
        self.image_points: list[list[float]] = []
        self.matrix: np.ndarray | None = None
        self.error: str | None = None
        self.persistence_error: str | None = None
        self.version = int(time.time() * 1000)
        self.load()

    def load(self) -> None:
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return
        except (OSError, json.JSONDecodeError) as exc:
            self.error = f"Cannot read detector calibration: {exc}"
            self.persistence_error = self.error
            print(f"[calibration] {self.error}")
            return
        try:
            if not isinstance(payload, dict):
                raise ValueError("Saved calibration must be a JSON object")
            if payload["target_size"] != list(self.target_size) or payload["target_points"] != [list(p) for p in self.target_points]:
                raise ValueError("Saved target geometry differs from configuration")
            if payload["center"] != list(self.center):
                raise ValueError("Saved target center differs from configuration")
            if payload.get("aruco_dictionary", self.dictionary) != self.dictionary:
                raise ValueError("Saved ArUco dictionary differs from configuration")
            expected_markers = {str(key): list(point) for key, point in self.marker_points.items()}
            if payload.get("aruco_reference_points_mm", expected_markers) != expected_markers:
                raise ValueError("Saved ArUco references differ from configuration")
            size = payload["frame_size"]
            if not isinstance(size, list) or len(size) != 2 or any(type(v) is not int or v < 1 for v in size):
                raise ValueError("Invalid saved frame size")
            self.frame_size = (size[0], size[1])
            self.update(payload, persist=False)
            if payload.get("calibration_valid") is False:
                self.matrix = None
                self.error = str(payload.get("invalidation_reason", "Recalibration required"))
        except (KeyError, TypeError, ValueError, cv2.error) as exc:
            self.matrix = None
            self.error = f"Invalid detector calibration: {exc}"
            self.persistence_error = self.error
            print(f"[calibration] {self.error}")

    def set_frame_size(self, width: int, height: int) -> bool:
        size = (width, height)
        if self.frame_size == size:
            return False
        previous = self.frame_size
        self.frame_size = size
        self.invalidate("Frame dimensions changed" if previous is not None else "Calibration required")
        self.image_points = []
        if self.roi is not None:
            x, y, rw, rh = self.roi
            if x + rw > width or y + rh > height:
                self.roi = None
        return True

    def invalidate(self, reason: str) -> None:
        if self.matrix is not None and self.path.exists():
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            payload["calibration_valid"] = False
            payload["invalidation_reason"] = reason
            self._save(payload)
        self.matrix = None
        self.error = reason
        self.version += 1

    def _fit(self, image_points: object, target_points: object) -> np.ndarray:
        try:
            source = np.asarray(image_points, dtype=np.float64)
            target = np.asarray(target_points, dtype=np.float64)
        except (TypeError, ValueError) as exc:
            raise ValueError("Reference coordinates must be numeric") from exc
        if (
            source.ndim != 2 or source.shape[1] != 2 or len(source) < 4
            or source.shape != target.shape or not np.all(np.isfinite(source))
            or not np.all(np.isfinite(target))
        ):
            raise ValueError("Homography needs at least four finite image/world point pairs")
        if self.frame_size is None:
            raise ValueError("Camera frame dimensions are unavailable")
        width, height = self.frame_size
        if np.any(source < 0) or np.any(source[:, 0] >= width) or np.any(source[:, 1] >= height):
            raise ValueError("Reference points must lie inside the source frame")
        for points in (source, target):
            if np.linalg.matrix_rank(points - points.mean(axis=0)) < 2:
                raise ValueError("Reference points must not be collinear")
            if len(np.unique(points, axis=0)) != len(points):
                raise ValueError("Reference points must be distinct")
            if len(points) == 4 and not cv2.isContourConvex(points.astype(np.float32).reshape(-1, 1, 2)):
                raise ValueError("Four reference points must form an ordered convex quadrilateral")
        matrix, inliers = cv2.findHomography(source, target, cv2.RANSAC, self.ransac_mm)
        if matrix is None or inliers is None or np.count_nonzero(inliers) < 4:
            raise ValueError("Insufficient homography inliers")
        if not np.all(np.isfinite(matrix)) or np.linalg.matrix_rank(matrix) < 3:
            raise ValueError("Invalid homography matrix")
        projected = cv2.perspectiveTransform(target.reshape(-1, 1, 2), np.linalg.inv(matrix)).reshape(-1, 2)
        errors = np.linalg.norm(projected - source, axis=1)[inliers.ravel() != 0]
        if not np.all(np.isfinite(errors)) or float(errors.max()) > self.max_error_px:
            raise ValueError("Homography reprojection error exceeds the source-pixel limit")
        return matrix

    def update(self, payload: dict[str, object], persist: bool = True) -> None:
        if self.frame_size is None:
            raise ValueError("Camera frame dimensions are unavailable")
        if "frame_size" in payload and payload["frame_size"] != list(self.frame_size):
            raise ValueError("Calibration snapshot has stale frame dimensions")
        if "version" in payload and payload["version"] != self.version:
            raise ValueError("Calibration snapshot is stale; reload the preview")
        mode = payload.get("mapping_mode", self.mode)
        if mode not in ("fixed_center", "legacy", "homography"):
            raise ValueError("Unknown mapping mode")
        roi = self.roi
        if "roi" in payload:
            raw = payload["roi"]
            if raw is None:
                roi = None
            else:
                if not isinstance(raw, list) or len(raw) != 4 or any(type(v) is not int for v in raw):
                    raise ValueError("ROI must contain four integer source-pixel values")
                x, y, rw, rh = raw
                width, height = self.frame_size
                if min(x, y) < 0 or min(rw, rh) <= 0 or x + rw > width or y + rh > height:
                    raise ValueError("ROI must lie inside the source frame")
                roi = (x, y, rw, rh)
        points = self.image_points
        matrix = self.matrix
        if "image_points" in payload:
            raw_points = payload["image_points"]
            if not isinstance(raw_points, list):
                raise ValueError("image_points must be an array")
            if len(raw_points) == 0:
                points, matrix = [], None
            elif len(raw_points) == 4:
                matrix = self._fit(raw_points, self.target_points)
                points = np.asarray(raw_points, dtype=float).tolist()
            else:
                raise ValueError("Manual calibration requires exactly four ordered reference points")
        data = {
            "frame_size": list(self.frame_size), "roi": list(roi) if roi is not None else None,
            "image_points": points, "mapping_mode": mode,
            "target_size": list(self.target_size), "center": list(self.center),
            "target_points": [list(p) for p in self.target_points],
            "calibration_valid": matrix is not None,
            "aruco_dictionary": self.dictionary,
            "aruco_reference_points_mm": {str(key): list(point) for key, point in self.marker_points.items()},
        }
        if persist:
            self._save(data)
            self.persistence_error = None
        self.roi, self.mode, self.image_points, self.matrix = roi, str(mode), points, matrix
        self.error = None if matrix is not None else "Calibration required"
        self.version += 1

    def _save(self, payload: dict[str, object]) -> None:
        temporary = self.path.with_suffix(".tmp")
        try:
            temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            os.replace(temporary, self.path)
        finally:
            if temporary.exists():
                temporary.unlink()

    def calibrate_markers(self, frame: np.ndarray) -> None:
        if not self.marker_points:
            raise ValueError("Configure ARUCO_REFERENCE_POINTS_MM or select four manual points")
        if not hasattr(cv2, "aruco"):
            raise RuntimeError("Installed OpenCV does not expose cv2.aruco")
        dictionary_id = getattr(cv2.aruco, self.dictionary, None)
        if dictionary_id is None:
            raise ValueError("Unknown ArUco dictionary")
        detector = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(dictionary_id))
        corners, ids, _ = detector.detectMarkers(frame)
        if ids is None:
            raise ValueError("No ArUco markers are visible")
        image, world = [], []
        for corner, marker_id in zip(corners, ids.ravel()):
            if int(marker_id) in self.marker_points:
                image.append(corner.reshape(-1, 2).mean(axis=0).tolist())
                world.append(self.marker_points[int(marker_id)])
        if len(world) == 4:
            points = np.asarray(world)
            midpoint = points.mean(axis=0)
            order = np.argsort(np.arctan2(points[:, 1] - midpoint[1], points[:, 0] - midpoint[0]))
            image = [image[int(index)] for index in order]
            world = [world[int(index)] for index in order]
        matrix = self._fit(image, world)
        # Persist equivalent paper reference points so loading does not need visible markers.
        paper = np.asarray(self.target_points, dtype=np.float64).reshape(-1, 1, 2)
        points = cv2.perspectiveTransform(paper, np.linalg.inv(matrix)).reshape(-1, 2).tolist()
        self.update({"image_points": points})

    def transform(self, x: float, y: float) -> tuple[float, float]:
        if self.matrix is None:
            raise ValueError(self.error or "Homography is not calibrated")
        point = cv2.perspectiveTransform(np.array([[[x, y]]], dtype=np.float64), self.matrix)[0, 0]
        if not np.all(np.isfinite(point)):
            raise ValueError("Shot transformation is not finite")
        return float(point[0]), float(point[1])

    def detection_region(
        self, override: tuple[int, int, int, int] | None = None,
    ) -> tuple[tuple[int, int, int, int], np.ndarray]:
        if self.matrix is None or self.frame_size is None:
            raise ValueError("Calibrated paper region is unavailable")
        width, height = self.frame_size
        tw, th = self.target_size
        paper = np.array([[[0., 0.], [tw, 0.], [tw, th], [0., th]]], dtype=np.float64)
        corners = cv2.perspectiveTransform(paper, np.linalg.inv(self.matrix))[0]
        if not np.all(np.isfinite(corners)):
            raise ValueError("Paper projection is not finite")
        if override is None:
            left, top = np.floor(corners.min(axis=0)).astype(int)
            right, bottom = np.ceil(corners.max(axis=0)).astype(int) + 1
            left, top = max(0, int(left)), max(0, int(top))
            right, bottom = min(width, int(right)), min(height, int(bottom))
            roi = (left, top, right - left, bottom - top)
        else:
            roi = override
        x, y, rw, rh = roi
        if min(x, y) < 0 or min(rw, rh) < 1 or x + rw > width or y + rh > height:
            raise ValueError("Paper ROI is outside the source frame")
        mask = np.zeros((rh, rw), np.uint8)
        polygon = np.rint(corners - np.array([x, y])).astype(np.int32)
        cv2.fillConvexPoly(mask, polygon, 255)
        if not np.any(mask):
            raise ValueError("ROI does not intersect the calibrated paper")
        return roi, mask

    def status(self) -> dict[str, object]:
        return {
            "frame_size": list(self.frame_size) if self.frame_size else None,
            "roi": list(self.roi) if self.roi is not None else None,
            "image_points": self.image_points, "mapping_mode": self.mode,
            "calibrated": self.matrix is not None,
            "error": self.persistence_error or (self.error if self.mode == "homography" else None),
            "version": self.version,
            "target_size": list(self.target_size), "target_points": [list(p) for p in self.target_points],
        }
