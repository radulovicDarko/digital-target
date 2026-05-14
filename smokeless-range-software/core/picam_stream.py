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
from typing import Optional, Tuple

import numpy as np
import cv2


class PiCamStream:
    def __init__(self, width: int = 960, height: int = 540, fps: int = 60) -> None:
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
        self._af_mode: str = (os.environ.get("SHOOTERRANGE_PICAM_AF_MODE", "auto") or "auto").lower()
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
        if self._af_mode == "continuous":
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

    def open(self) -> bool:
        try:
            cam = self._Picamera2()
            cfg = cam.create_video_configuration(
                # libcamera delivers RGB888 in *RGB* byte order; the rest of
                # this codebase (HSV thresholds, OpenCV draws) assumes BGR,
                # so we capture as BGR888 to skip a per-frame swap.
                main={"size": (self.width, self.height), "format": "BGR888"},
                controls={"FrameRate": float(self.fps)},
            )
            cam.configure(cfg)
            cam.start()
            self._try_enable_autofocus(cam)
            self._cam = cam
            return True
        except Exception as e:  # noqa: BLE001
            print(f"[picam_stream] open failed: {e}")
            self._cam = None
            return False

    def read(self) -> Tuple[bool, Optional[np.ndarray]]:
        if self._cam is None:
            return False, None
        try:
            frame = self._cam.capture_array("main")  # type: ignore[attr-defined]
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
