"""picamera2 wrapper exposing the same open()/read()/release() interface
as :class:`core.ffmpeg_stream.FFmpegStream`.

Used on Raspberry Pi (Bookworm + libcamera) with Camera Module 3, HQ camera,
or any other CSI/USB camera supported by libcamera. Capture happens directly
into a numpy ndarray — much lower latency than the FFmpeg/RTSP pipeline that
the Mac dev workflow uses.

The import of :mod:`picamera2` is deferred so the module can be loaded on
machines that don't have it installed (e.g. a developer Mac); construction
will only fail when actually instantiated.
"""
from __future__ import annotations

import os
import sys
import time
import math
from typing import Optional, Tuple

import numpy as np
import cv2


class PiCamStream:
    def __init__(
        self, width: int = 960, height: int = 540, fps: int = 60, *,
        auto_exposure: bool = False, exposure_us: int = 8000,
        analogue_gain: float = 1.0, auto_white_balance: bool = False,
        colour_gains: Tuple[float, float] = (1.5, 1.5),
        af_mode: str | None = None, lens_reset_delta: float = 0.05,
    ) -> None:
        if (
            min(width, height, fps, exposure_us, analogue_gain, *colour_gains) <= 0
            or not all(math.isfinite(v) for v in (exposure_us, analogue_gain, *colour_gains))
            or exposure_us > 1_000_000 / fps
        ):
            raise ValueError("Camera size/gains must be positive and exposure must fit a frame interval")
        if type(auto_exposure) is not bool or type(auto_white_balance) is not bool:
            raise ValueError("Camera AE/AWB settings must be booleans")
        if not math.isfinite(lens_reset_delta) or lens_reset_delta <= 0:
            raise ValueError("Camera lens reset tolerance must be finite and positive")
        self._lens_reset_delta = lens_reset_delta
        self.requested_controls = {
            "AeEnable": auto_exposure, "AwbEnable": auto_white_balance,
            "ExposureTime": exposure_us, "AnalogueGain": analogue_gain,
            "ColourGains": colour_gains,
        }
        self._detection_controls = dict(self.requested_controls)
        self.metadata: dict[str, object] = {}
        self.geometry_changed = False
        self.controls_settled = True
        self._settled_samples = 0
        self.control_error: str | None = None
        self._controls_deadline = 0.0
        self._lens_position: float | None = None
        # Local import — picamera2 is Linux/Pi-only and must not block the
        # module from being importable on macOS for tests.
        try:
            from picamera2 import Picamera2  # type: ignore
        except Exception as e:  # noqa: BLE001
            # When running inside a venv, apt-installed picamera2 often lives
            # in /usr/lib/python3/dist-packages which isn't on sys.path.
            for p in ("/usr/lib/python3/dist-packages", "/usr/local/lib/python3/dist-packages"):
                if p not in sys.path and os.path.isdir(p):
                    sys.path.append(p)
            try:
                from picamera2 import Picamera2  # type: ignore
            except Exception as e2:  # noqa: BLE001
                raise RuntimeError(
                    "picamera2 is not available — install it with "
                    "`sudo apt install python3-picamera2` on Raspberry Pi OS, "
                    "or set CAMERA_BACKEND='rtsp' in config.py to keep using the "
                    "FFmpeg/RTSP pipeline."
                ) from e2
        self._Picamera2 = Picamera2  # noqa: N806
        self.width = int(width)
        self.height = int(height)
        self.fps = int(fps)
        self._cam: Optional["object"] = None  # type: ignore[name-defined]

        # ---- Autofocus tuning (best-effort) ----
        self._af_supported = False
        self._af_trigger_value = None
        self._af_mode = af_mode if af_mode is not None else (os.environ.get("SHOOTERRANGE_PICAM_AF_MODE", "auto") or "auto").lower()
        if self._af_mode not in ("once", "auto", "continuous", "0", "off", "false", "none"):
            raise ValueError("Unsupported camera autofocus mode")
        self._configured_af_mode = self._af_mode
        self._frame_idx = 0
        self._last_af_trigger_ts = 0.0
        try:
            self._blur_check_every = max(5, int(os.environ.get("SHOOTERRANGE_PICAM_AF_BLUR_EVERY_FRAMES", "45")))
        except Exception:
            self._blur_check_every = 45
        try:
            self._blur_threshold = float(os.environ.get("SHOOTERRANGE_PICAM_AF_BLUR_THRESHOLD", "30"))
        except Exception:
            self._blur_threshold = 30.0
        try:
            self._af_refire_sec = float(os.environ.get("SHOOTERRANGE_PICAM_AF_REFIRE_SEC", "2.0"))
        except Exception:
            self._af_refire_sec = 2.0

    def _try_enable_autofocus(self, cam: "object") -> None:  # noqa: ANN401
        """Best-effort continuous AF.

        Only works on cameras that expose AF controls (e.g. Camera Module 3).
        Safe no-op on fixed-focus modules.
        """
        if self._af_mode in ("0", "off", "false", "none"):
            return

        # First, check whether the camera advertises AF controls.
        try:
            cam_controls = getattr(cam, "camera_controls", None)
            if isinstance(cam_controls, dict) and "AfMode" not in cam_controls:
                return
        except Exception:
            # If we cannot introspect controls, still try setting below.
            pass

        try:
            import libcamera  # type: ignore

            controls = getattr(libcamera, "controls", None)
            if controls is None:
                return

            # Prefer enums when available; fall back to common numeric values.
            af_mode_auto = getattr(getattr(controls, "AfModeEnum", object()), "Auto", 1)
            af_mode_cont = getattr(getattr(controls, "AfModeEnum", object()), "Continuous", 2)
            af_range = getattr(getattr(controls, "AfRangeEnum", object()), "Normal", 1)
            af_speed = getattr(getattr(controls, "AfSpeedEnum", object()), "Fast", 2)
            af_trigger = getattr(getattr(controls, "AfTriggerEnum", object()), "Start", 0)

            mode = self._af_mode
            if mode == "continuous":
                af_mode = af_mode_cont
            else:
                # Default: auto. AF_TRIGGER is meaningful here.
                af_mode = af_mode_auto

            cam.set_controls({
                "AfMode": af_mode,
                "AfRange": af_range,
                "AfSpeed": af_speed,
            })

            self._af_supported = True
            self._af_trigger_value = af_trigger
            self._last_af_trigger_ts = 0.0
            print(f"[picam_stream] autofocus: enabled mode={mode}")

            # Kick an initial focus run only in auto mode.
            if mode != "continuous":
                try:
                    cam.set_controls({"AfTrigger": af_trigger})
                except Exception:
                    # Some stacks warn when triggering is unsupported; ignore.
                    pass
        except Exception as e:  # noqa: BLE001
            print(f"[picam_stream] autofocus: enable failed ({e})")
            self._af_supported = False
            self._af_trigger_value = None

    def _maybe_retrigger_af(self, frame: np.ndarray) -> None:
        if not self._af_supported or self._cam is None:
            return
        # In continuous AF mode, do not spam AfTrigger (libcamera often warns).
        if self._af_mode in ("continuous", "once", "0", "off", "false", "none"):
            return
        self._frame_idx += 1
        if self._frame_idx % self._blur_check_every != 0:
            return

        # Cheap blur metric: variance of Laplacian on a downscaled grayscale.
        try:
            small = cv2.resize(frame, (0, 0), fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            v = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        except Exception:
            return

        if v >= self._blur_threshold:
            return
        # Throttle triggers so AF isn't spammed.
        now = time.time()
        if (now - self._last_af_trigger_ts) < float(self._af_refire_sec):
            return
        trig = self._af_trigger_value
        if trig is None:
            return
        try:
            self._cam.set_controls({"AfTrigger": trig})  # type: ignore[attr-defined]
            self._last_af_trigger_ts = now
            print(f"[picam_stream] autofocus: retrigger (blur={v:.1f})")
        except Exception:
            return

    def set_calibration_mode(self, mode: str) -> None:
        if mode not in ("alignment", "detection"):
            raise ValueError("Camera mode must be alignment or detection")
        if self._cam is None:
            raise RuntimeError("Camera is not open")
        alignment = mode == "alignment"
        controls = {"AeEnable": True, "AwbEnable": True} if alignment else {
            **self._detection_controls, "AeEnable": False, "AwbEnable": False,
        }
        if not alignment:
            gains = self.metadata.get("ColourGains")
            if not isinstance(gains, (tuple, list)) or len(gains) != 2 or not all(
                isinstance(value, (int, float)) and math.isfinite(value) and value > 0
                for value in gains
            ):
                raise RuntimeError("Camera white balance is not available yet")
            controls["ColourGains"] = tuple(float(value) for value in gains)
        camera_controls = self._cam.camera_controls  # type: ignore[attr-defined]
        focus_enabled = (
            "AfMode" in camera_controls
            and self._configured_af_mode not in ("0", "off", "false", "none")
        )
        if focus_enabled:
            controls["AfMode"] = 2 if alignment else 0
            if not alignment:
                lens = self.metadata.get("LensPosition")
                if not isinstance(lens, (int, float)) or not math.isfinite(lens) or lens < 0:
                    raise RuntimeError("Camera focus position is not available yet")
                controls["LensPosition"] = float(lens)
        missing = set(controls) - set(camera_controls)
        if missing:
            raise RuntimeError(f"Camera does not support requested controls: {sorted(missing)}")
        if not alignment:
            for key in ("ExposureTime", "AnalogueGain"):
                limits = camera_controls[key]
                value = controls[key]
                if not isinstance(value, (int, float)):
                    raise ValueError(f"Camera {key} must be numeric")
                if isinstance(limits, (tuple, list)) and len(limits) >= 2 and all(
                    isinstance(bound, (int, float)) and math.isfinite(bound) for bound in limits[:2]
                ):
                    value = min(max(value, limits[0]), limits[1])
                    controls[key] = int(value) if key == "ExposureTime" else float(value)
        self._cam.set_controls(controls)  # type: ignore[attr-defined]
        self.requested_controls = controls
        self._af_mode = "continuous" if alignment and focus_enabled else "off"
        self.controls_settled = alignment
        self._settled_samples = 0
        self.control_error = None
        self._controls_deadline = time.monotonic() + 5.0

    def _controls_match_metadata(self) -> bool:
        checks = []
        # Minimum analogue gain is quantized (nominal 1.0 can measure about 1.12).
        for key, minimum_tolerance in (("ExposureTime", 100.0), ("AnalogueGain", 0.15)):
            expected = self.requested_controls.get(key)
            if not isinstance(expected, (int, float)):
                return False
            checks.append((self.metadata.get(key), expected, max(minimum_tolerance, expected * 0.05)))
        measured_gains = self.metadata.get("ColourGains")
        expected_gains = self.requested_controls.get("ColourGains")
        if not isinstance(measured_gains, (tuple, list)) or len(measured_gains) != 2:
            return False
        if not isinstance(expected_gains, (tuple, list)) or len(expected_gains) != 2:
            return False
        for measured, expected in zip(measured_gains, expected_gains):
            if not isinstance(expected, (int, float)):
                return False
            checks.append((measured, expected, max(0.05, expected * 0.05)))
        if "LensPosition" in self.requested_controls:
            checks.append((self.metadata.get("LensPosition"), self.requested_controls["LensPosition"], self._lens_reset_delta))
        return all(
            isinstance(measured, (int, float)) and isinstance(expected, (int, float))
            and math.isfinite(measured) and math.isfinite(expected)
            and abs(measured - expected) <= tolerance
            for measured, expected, tolerance in checks
        )

    def open(self) -> bool:
        cam = None
        try:
            cam = self._Picamera2()
            cfg = cam.create_video_configuration(
                # Picamera2 RGB888 is [B,G,R] in numpy (little-endian libcamera naming).
                main={"size": (self.width, self.height), "format": "RGB888"},
                controls={"FrameRate": float(self.fps)},
            )
            cam.configure(cfg)
            missing = set(self.requested_controls) - set(cam.camera_controls)
            if missing:
                raise RuntimeError(f"Camera does not support requested controls: {sorted(missing)}")
            cam.set_controls(self.requested_controls)
            cam.start()
            self._try_enable_autofocus(cam)
            self._cam = cam
            print(f"[picam_stream] requested exposure/WB: {self.requested_controls}")
            return True
        except Exception as e:  # noqa: BLE001
            print(f"[picam_stream] open failed: {e}")
            if cam is not None:
                cam.close()
            self._cam = None
            return False

    def read(self) -> Tuple[bool, Optional[np.ndarray]]:
        if self._cam is None:
            return False, None
        try:
            request = self._cam.capture_request()  # type: ignore[attr-defined]
            try:
                frame = request.make_array("main").copy()
                metadata = request.get_metadata()
                self.metadata = {
                    key: metadata[key] for key in (
                        "ExposureTime", "AnalogueGain", "ColourGains", "LensPosition",
                    ) if key in metadata
                }
                lens = metadata.get("LensPosition")
                self.geometry_changed = (
                    isinstance(lens, (int, float)) and self._lens_position is not None
                    and abs(float(lens) - self._lens_position) > self._lens_reset_delta
                )
                if isinstance(lens, (int, float)):
                    self._lens_position = float(lens)
                if not self.controls_settled:
                    self._settled_samples = self._settled_samples + 1 if self._controls_match_metadata() else 0
                    self.controls_settled = self._settled_samples >= 3
                    if self.controls_settled:
                        self.control_error = None
                    elif time.monotonic() > self._controls_deadline and self.control_error is None:
                        self.control_error = "Camera controls did not settle; return to positioning and retry locking"
                        print(f"[picam_stream] {self.control_error}")
            finally:
                request.release()
        except Exception as e:  # noqa: BLE001
            print(f"[picam_stream] read failed: {e}")
            return False, None
        if frame is None:
            return False, None
        # Some libcamera versions deliver BGRA from BGR888 configs; drop the
        # alpha channel so downstream cv2 calls see a 3-channel BGR image.
        if frame.ndim == 3 and frame.shape[2] == 4:
            frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)

        # Best-effort: if AF exists and we're seeing blur, retrigger.
        self._maybe_retrigger_af(frame)
        return True, frame

    def release(self) -> None:
        if self._cam is not None:
            try:
                self._cam.stop()  # type: ignore[attr-defined]
            except Exception:  # noqa: BLE001
                pass
            try:
                self._cam.close()  # type: ignore[attr-defined]
            except Exception:  # noqa: BLE001
                pass
            self._cam = None
