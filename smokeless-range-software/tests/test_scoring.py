"""Unit tests for the v2 fixed-center radial scorer (core/scoring.py).

Pure-Python, no OpenCV/NumPy — runnable with either:

    python -m pytest smokeless-range-software/tests/test_scoring.py
    python smokeless-range-software/tests/test_scoring.py

The target under test is the custom face: ring 1 = 83 mm, 9 mm step, the 10 is
a 2 mm centre dot; diabolo = 4.5 mm.
"""
import os
import sys
import json
import math
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from core.scoring import FixedGeometry, RadialScorer  # noqa: E402


RINGS = (83.0, 74.0, 65.0, 56.0, 47.0, 38.0, 29.0, 20.0, 11.0, 2.0)
INNER_TEN = 2.0
PELLET = 4.5
PAPER = 90.0

# 0.2 mm per pixel → ring 1 (83 mm) spans 415 px, so a 800×800 frame frames it.
MM_PER_PX = 0.2
FRAME = 800


def _scorer(mirror_x=True, mirror_y=False, offset=(0.0, 0.0)):
    return RadialScorer(
        ring_diameters_mm=RINGS,
        inner_ten_mm=INNER_TEN,
        pellet_mm=PELLET,
        mm_per_px=MM_PER_PX,
        paper_span_mm=PAPER,
        center_offset_px=offset,
        mirror_x=mirror_x,
        mirror_y=mirror_y,
    )


def test_dead_center_is_ten():
    s = _scorer()
    r = s.score(FRAME / 2, FRAME / 2, FRAME, FRAME)
    assert r.ring == 10
    assert r.score == 10
    assert r.dist_mm == 0.0
    # Centre maps to the middle of the paper.
    assert abs(r.x_norm - 0.5) < 1e-9
    assert abs(r.y_norm - 0.5) < 1e-9


def test_inner_ten_unreachable_for_2mm_dot():
    # The 10 is a 2 mm dot (radius 1 mm) but the diabolo is 4.5 mm (radius
    # 2.25 mm): a pellet can never be fully contained by the dot, so the
    # containment-based inner-ten flag is always False on this face. This is
    # physically correct and matches the legacy pellet-edge convention.
    s = _scorer()
    r = s.score(FRAME / 2, FRAME / 2, FRAME, FRAME)
    assert r.is_inner_ten is False



def test_pellet_edge_promotes_to_higher_ring():
    # Ring 1 outer radius = 41.5 mm. Pellet radius = 2.25 mm. A shot whose
    # CENTRE sits 43.0 mm out still clips ring 1 (43.0 - 2.25 = 40.75 <= 41.5).
    s = _scorer()
    dist_px = 43.0 / MM_PER_PX
    r = s.score(FRAME / 2 + dist_px, FRAME / 2, FRAME, FRAME)
    assert r.ring == 1
    # Just past the pellet-edge reach (e.g. 44.0 mm) it's a miss.
    r2 = s.score(FRAME / 2 + (44.0 / MM_PER_PX), FRAME / 2, FRAME, FRAME)
    assert r2.ring == 0
    assert r2.score == 0


def test_known_offset_lands_in_expected_ring():
    # Ring 8 outer radius = 10 mm, ring 9 outer radius = 5.5 mm. A shot centred
    # 8 mm from centre: pellet edge reaches 8 - 2.25 = 5.75 mm. That's inside
    # ring 8 (<=10) but outside ring 9 (>5.5) → ring 8.
    s = _scorer()
    r = s.score(FRAME / 2, FRAME / 2 + (8.0 / MM_PER_PX), FRAME, FRAME)
    assert r.ring == 8
    assert abs(r.dist_mm - 8.0) < 1e-6


def test_mirror_x_flips_sign_but_not_ring():
    mirrored = _scorer(mirror_x=True)
    plain = _scorer(mirror_x=False)
    # A hit to the right of centre in the camera image.
    px = FRAME / 2 + (20.0 / MM_PER_PX)
    rm = mirrored.score(px, FRAME / 2, FRAME, FRAME)
    rp = plain.score(px, FRAME / 2, FRAME, FRAME)
    # Same ring/distance regardless of mirror.
    assert rm.ring == rp.ring
    assert abs(rm.dist_mm - rp.dist_mm) < 1e-9
    # But the display X is flipped in sign.
    assert rm.x_mm == -rp.x_mm
    assert rm.x_norm != rp.x_norm
    # Mirror must not touch the vertical axis.
    assert rm.y_mm == rp.y_mm


def test_center_offset_shifts_origin():
    # Put the true centre 10 px right of image centre. A laser at image centre
    # is then 10 px = 2 mm LEFT of the true target centre.
    s = _scorer(offset=(10.0, 0.0))
    r = s.score(FRAME / 2, FRAME / 2, FRAME, FRAME)
    assert abs(r.dist_mm - (10.0 * MM_PER_PX)) < 1e-9


def test_norm_coords_stay_in_unit_range():
    s = _scorer()
    for px, py in [(0, 0), (FRAME, FRAME), (0, FRAME), (FRAME, 0)]:
        r = s.score(px, py, FRAME, FRAME)
        assert 0.0 <= r.x_norm <= 1.0
        assert 0.0 <= r.y_norm <= 1.0


def test_invalid_params_raise():
    for bad in (0.0, -1.0):
        try:
            RadialScorer(RINGS, INNER_TEN, PELLET, bad, PAPER)
        except ValueError:
            pass
        else:
            raise AssertionError("expected ValueError for mm_per_px=%r" % bad)
    try:
        RadialScorer((), INNER_TEN, PELLET, MM_PER_PX, PAPER)
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for empty ring list")


def test_current_print_geometry_and_scoring_agree():
    from config import RING_DIAMETERS_V2_MM, INNER_TEN_V2_MM

    # Original 960x540 camera frame: centre (448,255), outer diameter ~556 px.
    s = RadialScorer(
        RING_DIAMETERS_V2_MM, INNER_TEN_V2_MM, PELLET,
        83.0 / 556.0, PAPER, center_offset_px=(-32.0, -15.0),
    )
    center = s.score(448, 255, 960, 540)
    assert center.ring == 10 and center.dist_mm == 0.0
    assert center.x_norm == 0.5 and center.y_norm == 0.5
    for index, diameter in enumerate(RING_DIAMETERS_V2_MM):
        radius_px = diameter / (2 * (83.0 / 556.0))
        # Just inside/outside the pellet-edge reach of each displayed ring.
        reach_px = radius_px + (PELLET / 2) / (83.0 / 556.0)
        inside = s.score(448 + reach_px - 0.01, 255, 960, 540)
        outside = s.score(448 + reach_px + 0.01, 255, 960, 540)
        assert inside.ring == index + 1
        assert outside.ring == index
        assert inside.x_mm < 0  # Behind-paper mirror remains enabled.
    # The photographed ten spans ~40 px, not the old 2 mm / ~13 px dot.
    ten_diameter_px = RING_DIAMETERS_V2_MM[-1] / (83.0 / 556.0)
    assert 38 < ten_diameter_px < 43


def test_perspective_lens_projection_preserves_scoring():
    geometry = FixedGeometry((960, 540), shear=0.002, scale_y=1.013,
                             perspective_x=-0.016, perspective_y=0.049, radial_k1=-0.009)
    s = RadialScorer(RINGS, INNER_TEN, PELLET, 0.155, PAPER,
                     center_offset_px=(-31, -14), geometry=geometry)
    for ring, diameter in enumerate(RINGS, 1):
        for degrees in range(0, 360, 30):
            theta = math.radians(degrees)
            for delta, expected in ((-0.001, ring), (0.001, ring - 1)):
                distance = diameter / 2 + PELLET / 2 + delta
                x, y = distance * math.cos(theta), distance * math.sin(theta)
                pixel = s.project_mm(x, y, 960, 540)
                hit = s.score(*pixel, 960, 540)
                assert hit.ring == expected
                assert abs(hit.dist_mm - distance) < 1e-8
                assert abs(hit.x_mm + x) < 1e-8
                assert abs(hit.y_mm - y) < 1e-8
    points = s.ring_points(47, 960, 540)
    assert all(abs(s.score(*p, 960, 540).dist_mm - 23.5) < 1e-8 for p in points)
    assert abs(points[90][1] + points[270][1] - 2 * 256) > 1


def test_corrected_roi_contains_projected_paper_edges():
    geometry = FixedGeometry((960, 540), perspective_y=0.049, radial_k1=-0.009)
    s = RadialScorer(RINGS, INNER_TEN, PELLET, 0.18, PAPER, geometry=geometry)
    x1, y1, width, height = s.detection_roi(960, 540)
    for i in range(1001):
        position = -45 + 90 * i / 1000
        for x, y in ((position, -45), (position, 45), (-45, position), (45, position)):
            px, py = s.project_mm(x, y, 960, 540)
            if 0 <= px < 960 and 0 <= py < 540:
                assert x1 <= px <= x1 + width
                assert y1 <= py <= y1 + height


def test_fixed_profile_rejects_invalid_geometry_and_stale_dimensions():
    from core.calibration import load_fixed_calibration

    defaults = dict(mm_per_px=0.18, center_offset_x_px=0.0, center_offset_y_px=0.0)
    with tempfile.TemporaryDirectory() as directory:
        path = os.path.join(directory, "fixed.json")
        assert load_fixed_calibration(defaults, path) == defaults
        for invalid in ({"geometry": {}}, {"geometry": []}, {"mm_per_px": -1},
                        {"mm_per_px": float("nan")}):
            with open(path, "w", encoding="utf-8") as f:
                json.dump(invalid, f)
            try:
                load_fixed_calibration(defaults, path)
            except ValueError:
                pass
            else:
                raise AssertionError("Invalid fixed profile must not silently fall back")
    s = RadialScorer(RINGS, INNER_TEN, PELLET, 0.18, PAPER,
                     geometry=FixedGeometry((960, 540)))
    for operation in (lambda: s.score(400, 300, 800, 600),
                      lambda: s.ring_points(83, 800, 600),
                      lambda: s.detection_roi(800, 600)):
        try:
            operation()
        except ValueError:
            pass
        else:
            raise AssertionError("Stale camera dimensions must be rejected")


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\nAll {len(fns)} tests passed.")
