import concurrent.futures
from dataclasses import replace
import json
import math
import os
import sys
import tempfile
import types
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from core.control_server import ControlState, DetectorCommand, start_control_server
from core.detector import DetectorSettings, LaserDetector
from core.homography import TargetCalibration
from core.picam_stream import PiCamStream
import test_scoring


def background(level=12):
    return np.full((120, 160, 3), level, dtype=np.uint8)


def pulse(level=12, center=(80.3, 60.7), color="white"):
    yy, xx = np.indices((120, 160))
    intensity = 230 * np.exp(-((xx - center[0]) ** 2 + (yy - center[1]) ** 2) / 32)
    frame = background(level).astype(float)
    if color == "white":
        frame += intensity[:, :, None]
    else:
        frame[:, :, {"red": 2, "green": 1}[color]] += intensity
    return np.clip(frame, 0, 255).astype(np.uint8)


def seeded(settings=None, level=12, roi=None):
    detector = LaserDetector(settings or DetectorSettings(red_validation_enabled=False))
    for _ in range(detector.settings.warmup_frames + 1):
        detector.detect(background(level), roi)
    return detector


class TemporalTests(unittest.TestCase):
    def test_confirmation_subpixel_and_one_hit_per_long_flash(self):
        detector = seeded()
        frame = pulse()
        first, _ = detector.detect(frame)
        self.assertIsNone(first)
        hit, _ = detector.detect(frame)
        self.assertIsNotNone(hit)
        self.assertLess(math.dist((hit["x"], hit["y"]), (80.3, 60.7)), 1)
        self.assertTrue(detector.should_emit_shot())
        original = detector.background.copy()
        for _ in range(25):
            detection, _ = detector.detect(frame)
            self.assertIsNone(detection)
            self.assertFalse(detector.should_emit_shot())
        np.testing.assert_array_equal(original, detector.background)
        for _ in range(10):
            detector.detect(background())
        detector.detect(frame)
        hit, _ = detector.detect(frame)
        self.assertIsNotNone(hit)
        self.assertTrue(detector.should_emit_shot())

    def test_short_pulse_position_jump_and_uncommitted_candidate(self):
        detector = seeded()
        detector.detect(pulse())
        detector.detect(background())
        self.assertFalse(detector.should_emit_shot())
        detector.detect(pulse(center=(40, 40)))
        hit, _ = detector.detect(pulse(center=(100, 70)))
        self.assertIsNone(hit)
        hit, _ = detector.detect(pulse(center=(100, 70)))
        self.assertIsNotNone(hit)
        self.assertTrue(detector.armed)
        # Spatial/scoring rejection must not consume the cooldown.
        detector.detect(background())
        detector.detect(background())
        detector.detect(pulse())
        hit, _ = detector.detect(pulse())
        self.assertIsNotNone(hit)
        self.assertTrue(detector.should_emit_shot())

    def test_dark_and_bright_sensor_noise_has_no_shots(self):
        rng = np.random.default_rng(42)
        for level in (8, 150):
            detector = seeded(level=level)
            for _ in range(500):
                noise = rng.integers(-3, 4, size=(120, 160, 3))
                frame = np.clip(background(level).astype(int) + noise, 0, 255).astype(np.uint8)
                self.assertIsNone(detector.detect(frame)[0])
                self.assertFalse(detector.should_emit_shot())
            detector.detect(pulse(level=level))
            self.assertIsNotNone(detector.detect(pulse(level=level))[0])

    def test_global_light_changes_and_geometry_reset(self):
        detector = seeded()
        self.assertIsNone(detector.detect(background(150))[0])
        self.assertTrue(detector.scene_changed)
        self.assertEqual(detector.reason, "scene_unstable")
        for _ in range(10):
            self.assertIsNone(detector.detect(background(150))[0])
        self.assertIsNone(detector.detect(background(8))[0])
        self.assertTrue(detector.scene_changed)
        detector = seeded(roi=(20, 20, 100, 80))
        detector.detect(pulse(), (20, 20, 100, 80))
        self.assertIsNone(detector.detect(pulse(), (21, 20, 100, 80))[0])
        self.assertEqual(detector.reason, "geometry")

    def test_roi_offset_and_outside_reflection(self):
        roi = (40, 30, 90, 70)
        detector = seeded(roi=roi)
        detector.detect(pulse(), roi)
        hit, _ = detector.detect(pulse(), roi)
        self.assertLess(math.dist((hit["x"], hit["y"]), (80.3, 60.7)), 1)
        detector = seeded(roi=roi)
        for _ in range(4):
            self.assertIsNone(detector.detect(pulse(center=(10, 10)), roi)[0])

    def test_multiple_blobs_and_broad_glare_rejected(self):
        detector = seeded()
        frame = np.maximum(pulse(center=(45, 50)), pulse(center=(110, 50)))
        for _ in range(4):
            self.assertIsNone(detector.detect(frame)[0])
        self.assertEqual(detector.reason, "multiple_candidates")
        frame = background()
        frame[40:80, 20:140] = 200
        for _ in range(4):
            self.assertIsNone(detector.detect(frame)[0])

    def test_secondary_color_and_saturated_white(self):
        for color, accepted in (("red", True), ("green", False), ("white", True)):
            detector = seeded(DetectorSettings())
            frame = pulse(color=color)
            if color == "white":
                frame[57:65, 76:85] = 255
            detector.detect(frame)
            hit, _ = detector.detect(frame)
            self.assertEqual(hit is not None, accepted)

    def test_gaussian_refinement_and_explicit_fallback(self):
        detector = seeded()
        detector.detect(pulse())
        hit, _ = detector.detect(pulse())
        self.assertEqual(detector.refinement, "gaussian")
        self.assertLess(math.dist((hit["x"], hit["y"]), (80.3, 60.7)), 1)
        detector = seeded(replace(detector.settings, gaussian_max_error=0.000001))
        detector.detect(pulse())
        self.assertIsNotNone(detector.detect(pulse())[0])
        self.assertTrue(detector.refinement.startswith("weighted:"))

    def test_invalid_settings_roi_and_frame(self):
        for settings in (
            {"min_diff": 0}, {"background_alpha": float("nan")},
            {"confirmation_frames": 0}, {"blur_size": 4}, {"red_validation_enabled": 1},
        ):
            with self.assertRaises(ValueError):
                DetectorSettings(**settings)
        with self.assertRaises(ValueError):
            LaserDetector().detect(background(), (0, 0, 200, 100))
        with self.assertRaises(ValueError):
            LaserDetector().detect(np.zeros((10, 10), np.uint8))


class MappingTests(unittest.TestCase):
    def model(self, path):
        return TargetCalibration(
            path, ((0., 0.), (90., 0.), (90., 90.), (0., 90.)),
            (90., 90.), (45., 45.),
        )

    def test_perspective_mapping_persistence_and_invalidation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "calibration.json")
            model = self.model(path)
            model.set_frame_size(200, 180)
            points = [[10., 20.], [180., 15.], [160., 160.], [20., 150.]]
            model.update({"image_points": points, "mapping_mode": "homography", "roi": [10, 10, 180, 160]})
            for image, world in zip(points, model.target_points):
                np.testing.assert_allclose(model.transform(*image), world, atol=1e-5)
            loaded = self.model(path)
            self.assertEqual(loaded.mode, "homography")
            np.testing.assert_allclose(loaded.matrix, model.matrix)
            with self.assertRaises(ValueError):
                loaded.update({"roi": [0, 0, 20, 20], "version": -1})
            loaded.set_frame_size(100, 100)
            self.assertIsNone(loaded.matrix)
            self.assertIsNone(loaded.roi)
            self.assertIsNone(self.model(path).matrix)

    def test_mirrored_world_orientation_is_not_mirrored_twice(self):
        with tempfile.TemporaryDirectory() as directory:
            model = self.model(os.path.join(directory, "cal.json"))
            model.set_frame_size(160, 120)
            model.update({"image_points": [[140, 10], [20, 10], [20, 110], [140, 110]]})
            wx, wy = model.transform(120, 60)
            hit = test_scoring._scorer().score_mm(wx - 45, wy - 45)
            self.assertLess(hit.x_mm, 0)
            self.assertLess(hit.x_norm, 0.5)

    def test_aruco_centres_are_matched_by_id_not_detection_order(self):
        with tempfile.TemporaryDirectory() as directory:
            model = self.model(os.path.join(directory, "cal.json"))
            model.marker_points = {0: (0., 0.), 1: (90., 0.), 2: (90., 90.), 3: (0., 90.)}
            model.set_frame_size(180, 180)
            frame = np.full((180, 180, 3), 255, np.uint8)
            dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
            for marker_id, (x, y) in enumerate(((5, 5), (135, 5), (135, 135), (5, 135))):
                marker = cv2.aruco.generateImageMarker(dictionary, marker_id, 40)
                frame[y:y + 40, x:x + 40] = marker[:, :, None]
            model.calibrate_markers(frame)
            np.testing.assert_allclose(model.transform(24.5, 24.5), (0., 0.), atol=0.1)
            np.testing.assert_allclose(model.transform(154.5, 154.5), (90., 90.), atol=0.1)
            roi, mask = model.detection_region()
            self.assertGreater(np.count_nonzero(mask), 0)
            self.assertEqual(mask.shape, (roi[3], roi[2]))

    def test_invalid_points_and_corrupt_file_are_explicit(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "cal.json")
            model = self.model(path)
            model.set_frame_size(160, 120)
            for points in (
                [[10, 10], [20, 20], [30, 30], [40, 40]],
                [[10, 10], [140, 110], [140, 10], [10, 110]],
                [[10, 10], [140, 10], [140, 110], [float("nan"), 110]],
            ):
                with self.assertRaises(ValueError):
                    model.update({"image_points": points})
            with open(path, "w") as handle:
                json.dump({"unexpected": True}, handle)
            loaded = self.model(path)
            self.assertIsNotNone(loaded.error)
            self.assertIsNotNone(loaded.persistence_error)
            self.assertIsNotNone(loaded.status()["error"])
            with self.assertRaises(ValueError):
                loaded.transform(10, 10)
            loaded.set_frame_size(160, 120)
            loaded.update({"roi": [0, 0, 100, 100]})
            self.assertIsNone(loaded.persistence_error)


class IntegrationTests(unittest.TestCase):
    def test_alignment_suppresses_hits_and_preview_clear_preserves_registration(self):
        import app
        state = ControlState()
        state.preview_wanted = lambda: True
        commands = {
            0: DetectorCommand("capture_mode", {"mode": "alignment"}),
            20: DetectorCommand("capture_mode", {"mode": "detection"}),
            52: DetectorCommand("clear_preview", {}),
            53: DetectorCommand("calibration", {}),
            60: DetectorCommand("capture_mode", {"mode": "alignment"}),
        }
        superseded = DetectorCommand("capture_mode", {"mode": "detection"})
        before_clear = {}
        while_settling = {}
        class Stream:
            requested_controls = {}
            controls_settled = True
            def __init__(self):
                self.frames = iter(
                    [background()] * 8 + [pulse()] * 12
                    + [background()] * 7 + [pulse()] * 5
                    + [background()] * 10 + [pulse()] * 20 + [background()] * 5
                )
                self.index = 0
            def open(self):
                return True
            def read(self):
                if self.index == 32:
                    while_settling.update(state.detector_status())
                    self.controls_settled = True
                if self.index == 52:
                    before_clear.update(state.detector_status())
                if self.index == 60:
                    state._detector_commands.put(superseded)
                if self.index in commands:
                    state._detector_commands.put(commands[self.index])
                self.index += 1
                frame = next(self.frames, None)
                return frame is not None, frame
            def set_calibration_mode(self, mode):
                self.requested_controls = {"AeEnable": mode == "alignment"}
                self.controls_settled = mode == "alignment"
            def release(self):
                pass
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(app, "create_camera_stream", return_value=Stream()), \
             patch.object(app, "start_control_server"), \
             patch.object(app, "ControlState", return_value=state), \
             patch.object(app, "is_headless", return_value=True), \
             patch.object(app, "load_fixed_calibration", side_effect=lambda defaults: defaults), \
             patch.object(app._config, "DETECTOR_CALIBRATION_FILE", os.path.join(directory, "cal.json")), \
             patch.object(app._config, "DETECTOR_RED_VALIDATION_ENABLED", False), \
             patch.object(state, "publish_hit") as publish:
            app.main()
        self.assertEqual(publish.call_count, 1)
        self.assertEqual(commands[0].result["capture_mode"], "alignment")
        self.assertFalse(commands[0].result["alignment_locked"])
        self.assertTrue(commands[20].result["alignment_locked"])
        self.assertEqual(while_settling["detector"]["state"], "camera_settling")
        self.assertEqual(commands[52].result["preview_hits"], 0)
        self.assertEqual(before_clear["preview_hits"], 1)
        self.assertEqual(commands[52].result["detector"], before_clear["detector"])
        self.assertIsInstance(commands[53].error, ValueError)
        self.assertIn("Unlock", str(commands[53].error))
        self.assertTrue(all(command.done.is_set() for command in commands.values()))
        self.assertIsInstance(superseded.error, RuntimeError)
        self.assertTrue(superseded.done.is_set())
        self.assertEqual(commands[60].result["capture_mode"], "alignment")

    def test_application_registers_once_and_keeps_debug_preview_alive(self):
        import app
        class Stream:
            geometry_changed = False
            metadata = {}
            def __init__(self, long_pulse=True):
                self.frames = iter([background()] * 8 + [pulse()] * (20 if long_pulse else 3) + [background()] * 10)
            def open(self):
                return True
            def read(self):
                frame = next(self.frames, None)
                return frame is not None, frame
            def release(self):
                pass
        for corrupted in (False, True):
            with self.subTest(corrupted_calibration=corrupted):
                state = ControlState()
                state.preview_wanted = lambda: True
                with tempfile.TemporaryDirectory() as directory, \
                     patch.object(app, "create_camera_stream", return_value=Stream(not corrupted)), \
                     patch.object(app, "start_control_server"), \
                     patch.object(app, "ControlState", return_value=state), \
                     patch.object(app, "load_fixed_calibration", side_effect=lambda defaults: defaults), \
                     patch.object(app, "is_headless", return_value=True), \
                     patch.object(app._config, "DETECTOR_CALIBRATION_FILE", os.path.join(directory, "cal.json")), \
                     patch.object(app._config, "DETECTOR_RED_VALIDATION_ENABLED", False), \
                     patch.object(app._config, "DETECTOR_DEBUG", True), \
                     patch.object(state, "publish_hit") as publish:
                    if corrupted:
                        with open(os.path.join(directory, "cal.json"), "w", encoding="utf-8") as saved:
                            saved.write("{invalid")
                    app.main()
                self.assertEqual(publish.call_count, 0 if corrupted else 1)
                if not corrupted:
                    hit = publish.call_args.args[0]
                    self.assertEqual(hit["score"], 10)
                    self.assertTrue(0 <= hit["x_norm"] <= 1)
                jpeg = state.get_latest_jpeg(timeout=0)
                self.assertIsNotNone(jpeg)
                self.assertIsNotNone(cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR))
                self.assertFalse(state.detector_status()["available"])

    def test_off_paper_candidate_does_not_delay_next_valid_shot(self):
        import app
        class Stream:
            def __init__(self):
                self.frames = iter(
                    [background()] * 8 + [pulse(center=(10, 10))] * 3
                    + [background()] * 2 + [pulse()] * 3
                )
            def open(self):
                return True
            def read(self):
                frame = next(self.frames, None)
                return frame is not None, frame
            def release(self):
                pass
        state = ControlState()
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(app, "create_camera_stream", return_value=Stream()), \
             patch.object(app, "start_control_server"), \
             patch.object(app, "ControlState", return_value=state), \
             patch.object(app, "is_headless", return_value=True), \
             patch.object(app, "load_fixed_calibration", side_effect=lambda defaults: defaults), \
             patch.object(app, "FIXED_MM_PER_PX", 2.0), \
             patch.object(app._config, "DETECTOR_CALIBRATION_FILE", os.path.join(directory, "cal.json")), \
             patch.object(app._config, "DETECTOR_ROI", (0, 0, 160, 120)), \
             patch.object(app._config, "DETECTOR_RED_VALIDATION_ENABLED", False), \
             patch.object(state, "publish_hit") as publish:
            app.main()
        self.assertEqual(publish.call_count, 1)

    def test_http_detector_failures_and_original_snapshot(self):
        state = ControlState()
        server = start_control_server(state, host="127.0.0.1", port=0)
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            bad = urllib.request.Request(
                base + "/api/detector/calibration", data=b"[1,2]",
                headers={"Content-Type": "application/json"},
            )
            with self.assertRaises(urllib.error.HTTPError) as response:
                urllib.request.urlopen(bad, timeout=2)
            self.assertEqual(response.exception.code, 400)
            with self.assertRaises(urllib.error.HTTPError) as response:
                urllib.request.urlopen(base + "/api/detector/snapshot.jpg", timeout=2)
            self.assertEqual(response.exception.code, 503)
            _, encoded = cv2.imencode(".jpg", background())
            state.push_raw_frame(encoded.tobytes())
            with urllib.request.urlopen(base + "/api/detector/snapshot.jpg", timeout=2) as response:
                jpeg = response.read()
            image = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
            self.assertEqual(image.shape, (120, 160, 3))
            state.update_detector_status({"available": True})
            request = urllib.request.Request(
                base + "/api/detector/calibration", data=b"{}",
                headers={"Content-Type": "application/json"},
            )
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                result = pool.submit(urllib.request.urlopen, request, timeout=2)
                command = state._detector_commands.get(timeout=1)
                command.error = ValueError("invalid ROI")
                command.done.set()
                with self.assertRaises(urllib.error.HTTPError) as response:
                    result.result(timeout=2)
                self.assertEqual(response.exception.code, 400)
                self.assertIn("invalid ROI", response.exception.read().decode())
        finally:
            server.shutdown()
            server.server_close()

    def test_capture_command_acknowledges_errors_not_success(self):
        state = ControlState()
        with self.assertRaises(RuntimeError):
            state.request_detector_command("reset", {})
        state.update_detector_status({"available": True})
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            result = pool.submit(state.request_detector_command, "calibration", {})
            command = state._detector_commands.get(timeout=1)
            command.error = ValueError("invalid ROI")
            command.done.set()
            with self.assertRaisesRegex(ValueError, "invalid ROI"):
                result.result(timeout=1)

    def test_picamera_controls_and_bgr_format(self):
        class Request:
            def make_array(self, _):
                return np.zeros((10, 10, 3), np.uint8)
            def get_metadata(self):
                return {"ExposureTime": 8000, "ColourGains": (1.5, 1.5), "LensPosition": 1.0}
            def release(self):
                pass
        class Camera:
            camera_controls = dict.fromkeys((
                "AeEnable", "AwbEnable", "ExposureTime", "AnalogueGain", "ColourGains",
                "AfMode", "LensPosition",
            ))
            def create_video_configuration(self, **kwargs):
                self.config = kwargs
                return kwargs
            def configure(self, config):
                self.config = config
            def set_controls(self, controls):
                self.controls = controls
            def start(self):
                pass
            def capture_request(self):
                return Request()
            def stop(self):
                pass
            def close(self):
                pass
        with patch.dict(sys.modules, {"picamera2": types.SimpleNamespace(Picamera2=Camera)}):
            stream = PiCamStream()
            with patch.object(stream, "_try_enable_autofocus"):
                self.assertTrue(stream.open())
            self.assertEqual(stream._cam.config["main"]["format"], "RGB888")
            self.assertFalse(stream._cam.controls["AeEnable"])
            self.assertFalse(stream._cam.controls["AwbEnable"])
            self.assertTrue(stream.read()[0])
            self.assertEqual(stream.metadata["ExposureTime"], 8000)
            stream.set_calibration_mode("alignment")
            self.assertTrue(stream._cam.controls["AeEnable"])
            self.assertTrue(stream._cam.controls["AwbEnable"])
            self.assertEqual(stream._cam.controls["AfMode"], 2)
            stream.metadata = {"ColourGains": (1.25, 1.75), "LensPosition": 2.5}
            stream.set_calibration_mode("detection")
            self.assertFalse(stream._cam.controls["AeEnable"])
            self.assertFalse(stream._cam.controls["AwbEnable"])
            self.assertEqual(stream._cam.controls["ExposureTime"], 8000)
            self.assertEqual(stream._cam.controls["AnalogueGain"], 1.0)
            self.assertEqual(stream._cam.controls["ColourGains"], (1.25, 1.75))
            self.assertEqual(stream._cam.controls["AfMode"], 0)
            self.assertEqual(stream._cam.controls["LensPosition"], 2.5)
            self.assertFalse(stream.controls_settled)
            measured = {
                "ExposureTime": 32000, "AnalogueGain": 1.0,
                "ColourGains": (1.25, 1.75), "LensPosition": 2.5,
            }
            with patch.object(Request, "get_metadata", return_value=measured), \
                 patch("core.picam_stream.time.monotonic", return_value=stream._controls_deadline + 1):
                stream.read()
                self.assertFalse(stream.controls_settled)
                self.assertIn("did not settle", stream.control_error)
            measured["ExposureTime"] = 8000
            with patch.object(Request, "get_metadata", return_value=measured):
                stream.read()
                stream.read()
                self.assertFalse(stream.controls_settled)
                stream.read()
                self.assertTrue(stream.controls_settled)
                self.assertIsNone(stream.control_error)
            stream._af_supported = True
            stream._af_trigger_value = 0
            with patch.object(stream._cam, "set_controls") as set_controls:
                stream._maybe_retrigger_af(background())
                set_controls.assert_not_called()
            stream.set_calibration_mode("alignment")
            stream.metadata = {}
            with self.assertRaisesRegex(RuntimeError, "white balance"):
                stream.set_calibration_mode("detection")
            self.assertTrue(stream.requested_controls["AeEnable"])
            stream.release()


def load_tests(loader, suite, pattern):
    for name in sorted(dir(test_scoring)):
        if name.startswith("test_"):
            suite.addTest(unittest.FunctionTestCase(getattr(test_scoring, name)))
    return suite


if __name__ == "__main__":
    unittest.main()
