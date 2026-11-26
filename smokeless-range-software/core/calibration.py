def map_point_to_target(x, y, x1, y1, x2, y2):
    if x2 <= x1 or y2 <= y1:
        return None

    nx = (x - x1) / float(x2 - x1)
    ny = (y - y1) / float(y2 - y1)

    nx = max(0.0, min(1.0, nx))
    ny = max(0.0, min(1.0, ny))

    return nx, ny


def point_inside_target(x, y, x1, y1, x2, y2):
    return x1 <= x <= x2 and y1 <= y <= y2


# ---------------------------------------------------------------------------
# v2 fixed-center calibration (reversible; the legacy helpers above are
# untouched). Kept completely separate from calibration_tweaks.json, which
# belongs to the legacy perspective pipeline.
# ---------------------------------------------------------------------------
import json
import os
import math
from collections.abc import Mapping
from typing import TypedDict

from core.scoring import FixedGeometry


class _FixedValues(TypedDict):
    mm_per_px: float
    center_offset_x_px: float
    center_offset_y_px: float


class FixedCalibration(_FixedValues, total=False):
    geometry: FixedGeometry

_FIXED_CAL_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "fixed_calibration.json",
)


def load_fixed_calibration(defaults: Mapping[str, float], path: str = _FIXED_CAL_FILE) -> FixedCalibration:
    """Load persisted v2 fixed-center calibration, falling back to ``defaults``.

    ``defaults`` is a dict with keys ``mm_per_px``, ``center_offset_x_px`` and
    ``center_offset_y_px`` (typically the config.py constants). The JSON file,
    written by the one-off calibration routine, overrides any keys it provides.
    An optional geometry object corrects perspective/lens distortion. Missing
    files use defaults; invalid saved calibration fails explicitly.
    """
    result: FixedCalibration = {
        "mm_per_px": float(defaults.get("mm_per_px", 0.0)),
        "center_offset_x_px": float(defaults.get("center_offset_x_px", 0.0)),
        "center_offset_y_px": float(defaults.get("center_offset_y_px", 0.0)),
    }
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        for key in ("mm_per_px", "center_offset_x_px", "center_offset_y_px"):
            if key in raw:
                result[key] = float(raw[key])
        if not all(math.isfinite(result[key]) for key in (
            "mm_per_px", "center_offset_x_px", "center_offset_y_px",
        )) or result["mm_per_px"] <= 0:
            raise ValueError("Fixed calibration values must be finite and scale positive")
        if "geometry" in raw:
            geometry = raw["geometry"]
            if not isinstance(geometry, dict):
                raise ValueError("Fixed geometry must be an object")
            size = geometry["frame_size"]
            if not isinstance(size, list) or len(size) != 2:
                raise ValueError("Fixed geometry needs a frame_size array")
            result["geometry"] = FixedGeometry(
                frame_size=(size[0], size[1]),
                normalization_px=float(geometry["normalization_px"]),
                shear=float(geometry["shear"]),
                scale_y=float(geometry["scale_y"]),
                perspective_x=float(geometry["perspective_x"]),
                perspective_y=float(geometry["perspective_y"]),
                radial_k1=float(geometry["radial_k1"]),
            )
    except FileNotFoundError:
        return result
    except (OSError, json.JSONDecodeError, TypeError, ValueError, KeyError) as exc:
        print(f"[fixed_calibration] Invalid saved calibration: {exc}")
        raise ValueError(f"Invalid fixed calibration: {exc}") from exc
    return result


def save_fixed_calibration(mm_per_px, center_offset_x_px, center_offset_y_px,
                           path=_FIXED_CAL_FILE):
    """Persist v2 fixed-center calibration so it survives restarts."""
    payload = {
        "mm_per_px": float(mm_per_px),
        "center_offset_x_px": float(center_offset_x_px),
        "center_offset_y_px": float(center_offset_y_px),
    }
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
    except OSError as e:
        print(f"[fixed_calibration] failed to save: {e}")
