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

_FIXED_CAL_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "fixed_calibration.json",
)


def load_fixed_calibration(defaults, path=_FIXED_CAL_FILE):
    """Load persisted v2 fixed-center calibration, falling back to ``defaults``.

    ``defaults`` is a dict with keys ``mm_per_px``, ``center_offset_x_px`` and
    ``center_offset_y_px`` (typically the config.py constants). The JSON file,
    written by the one-off calibration routine, overrides any keys it provides.
    Unknown keys are ignored so an older file never breaks startup, and a
    missing / malformed file simply yields the defaults.
    """
    result = {
        "mm_per_px": float(defaults.get("mm_per_px", 0.0)),
        "center_offset_x_px": float(defaults.get("center_offset_x_px", 0.0)),
        "center_offset_y_px": float(defaults.get("center_offset_y_px", 0.0)),
    }
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        for key in result:
            if key in raw:
                result[key] = float(raw[key])
    except (FileNotFoundError, json.JSONDecodeError, TypeError, ValueError, KeyError):
        pass
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
