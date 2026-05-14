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
        self._frame_idx = 0
        self._last_af_trigger_ts = 0.0
        self._blur_check_every = 45  # frames (~0.75s at 60 fps)
        self._blur_threshold = 30.0

    def _try_enable_autofocus(self, cam: "object") -> None:  # noqa: ANN401
        """Best-effort continuous AF.

        Only works on cameras that expose AF controls (e.g. Camera Module 3).
        Safe no-op on fixed-focus modules.
        """
        try:
            import libcamera  # type: ignore

            controls = getattr(libcamera, "controls", None)
            if controls is None:
                return

            # Prefer enums when available; fall back to common numeric values.
            af_mode = getattr(getattr(controls, "AfModeEnum", object()), "Continuous", 2)
            af_range = getattr(getattr(controls, "AfRangeEnum", object()), "Normal", 1)
            af_speed = getattr(getattr(controls, "AfSpeedEnum", object()), "Fast", 2)
            af_trigger = getattr(getattr(controls, "AfTriggerEnum", object()), "Start", 0)

            try:
                cam.set_controls({
                    "AfMode": af_mode,
                    "AfRange": af_range,
                    "AfSpeed": af_speed,
                })
                # Kick an initial focus run.
                cam.set_controls({"AfTrigger": af_trigger})
                self._af_supported = True
                self._af_trigger_value = af_trigger
                self._last_af_trigger_ts = 0.0
                print("[picam_stream] autofocus: continuous enabled")
            except Exception as e:  # noqa: BLE001
                print(f"[picam_stream] autofocus: controls rejected ({e})")
        except Exception:
            # libcamera python module not present / not a Pi.
            return

    def _maybe_retrigger_af(self, frame: np.ndarray) -> None:
        if not self._af_supported or self._cam is None:
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
        now = float(cv2.getTickCount() / cv2.getTickFrequency())
        if (now - self._last_af_trigger_ts) < 2.0:
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
