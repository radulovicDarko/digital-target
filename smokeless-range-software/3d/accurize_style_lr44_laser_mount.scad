// Accurize-style dry-fire laser housing for 3D printing
// Units: millimeters
// Two-piece clamshell body split along the Y axis.
// Printable parts only: no simulated PCB, batteries, or laser module.

$fn = 128;

// ---------- Output ----------
// Options: "base_half", "lid_half", "battery_holder", "insert_test", "assembly".
part = "assembly";

// ---------- Main body ----------
body_d = 39.5;
body_h = 28.0;
split_gap = 0.18;
assembly_gap = 7.0;
shell_wall = 2.0;
internal_cavity_d = 35.0;
internal_cavity_h = 20.0;
internal_cavity_z = 0.0;

// ---------- Perfboard ----------
// Classic perfboard pitch is about 2.5mm. Boss positions are multiples of 2.5mm.
perfboard_d = 35.0;
perfboard_pitch = 2.5;
perfboard_screw_clearance_d = 2.2; // M2 screw through perfboard hole/slot
perfboard_screw_pilot_d = 1.55;    // M2 self-tapping pilot in printed boss
perfboard_boss_d = 5.0;
perfboard_boss_h = 4.0;
perfboard_boss_z = body_h/2 - shell_wall - perfboard_boss_h/2;
perfboard_screw_xy = 12.5;         // 5 * 2.5mm, aligned to perfboard grid
perfboard_points = [
  [ perfboard_screw_xy,  perfboard_screw_xy],
  [-perfboard_screw_xy,  perfboard_screw_xy],
  [ perfboard_screw_xy, -perfboard_screw_xy],
  [-perfboard_screw_xy, -perfboard_screw_xy]
];

// ---------- Battery holder pocket ----------
// User supplied holder dimensions: 26 x 15 x 14mm.
battery_holder_stl = "/Users/daka/Downloads/LR44x3.stl";
battery_holder_x = 26.0;
battery_holder_y = 15.0;
battery_holder_z = 14.0;
battery_clearance = 0.6;
battery_pocket_x = battery_holder_x + battery_clearance;
battery_pocket_y = battery_holder_y + battery_clearance;
battery_pocket_z = battery_holder_z + battery_clearance;
battery_pocket_z_center = -5.8;
battery_wire_channel_d = 2.0;
battery_holder_scale = 1.0;
battery_holder_rotation = [0, 0, 0];
battery_holder_center = [0, 0, battery_pocket_z_center];

// ---------- Barrel insert (.177 / 4.5mm) ----------
barrel_insert_d = 4.20;
barrel_insert_len = 36.0;
barrel_insert_tip_d = 3.70;
barrel_insert_tip_len = 5.0;
barrel_insert_stop_d = 13.5;
barrel_insert_stop_h = 4.0;

// Two O-ring grooves on the solid barrel insert.
oring_groove_d = 3.75;
oring_groove_w = 1.05;
oring_groove_1_from_tip = 10.0;
oring_groove_2_from_tip = 25.0;

// ---------- Laser ----------
// Laser module is 10mm long, 6mm diameter. It inserts from inside.
laser_d = 6.0;
laser_len = 10.0;
laser_clearance = 0.25;
laser_socket_depth = laser_len;
beam_aperture_d = 2.4;
laser_wire_channel_d = 2.0;

// ---------- Clamshell screws ----------
join_screw_clearance_d = 2.2; // M2 clearance in lid half
join_screw_pilot_d = 1.55;    // M2 pilot in base half
join_head_d = 4.6;
join_points = [
  [ 13.6,  9.5],
  [-13.6,  9.5],
  [ 13.6, -10.5],
  [-13.6, -10.5]
];

module rounded_cylinder(d, h, r = 0.8) {
  minkowski() {
    cylinder(d = d - 2*r, h = h - 2*r, center = true);
    sphere(r = r);
  }
}

module rounded_box(size, r = 0.8) {
  minkowski() {
    cube([size[0] - 2*r, size[1] - 2*r, size[2] - 2*r], center = true);
    sphere(r = r);
  }
}

module barrel_insert(local_origin_z = 0) {
  difference() {
    union() {
      translate([0, 0, local_origin_z - (barrel_insert_len - barrel_insert_tip_len)/2])
        cylinder(d = barrel_insert_d, h = barrel_insert_len - barrel_insert_tip_len, center = true);
      translate([0, 0, local_origin_z - barrel_insert_len + barrel_insert_tip_len/2])
        cylinder(d1 = barrel_insert_tip_d, d2 = barrel_insert_d, h = barrel_insert_tip_len, center = true);
    }

    translate([0, 0, local_origin_z - barrel_insert_len + oring_groove_1_from_tip])
      cylinder(d = oring_groove_d, h = oring_groove_w, center = true);
    translate([0, 0, local_origin_z - barrel_insert_len + oring_groove_2_from_tip])
      cylinder(d = oring_groove_d, h = oring_groove_w, center = true);
  }
}

module perfboard_bosses() {
  for (point = perfboard_points) {
    translate([point[0], point[1], perfboard_boss_z])
      cylinder(d = perfboard_boss_d, h = perfboard_boss_h, center = true);
  }
}

module perfboard_pilot_holes() {
  for (point = perfboard_points) {
    translate([point[0], point[1], perfboard_boss_z])
      cylinder(d = perfboard_screw_pilot_d, h = perfboard_boss_h + 0.6, center = true);
  }
}

module imported_battery_holder(extra_clearance = 0) {
  translate(battery_holder_center)
    rotate(battery_holder_rotation)
      scale([battery_holder_scale, battery_holder_scale, battery_holder_scale])
        translate([-battery_holder_x/2, -battery_holder_y/2, -battery_holder_z/2])
          offset_import(extra_clearance);
}

module offset_import(extra_clearance = 0) {
  if (extra_clearance == 0) {
    import(battery_holder_stl, convexity = 10);
  } else {
    minkowski() {
      import(battery_holder_stl, convexity = 10);
      sphere(r = extra_clearance);
    }
  }
}

module solid_outer_body() {
  union() {
    rounded_cylinder(d = body_d, h = body_h, r = 0.9);

    // Closed lower side with positive stop and solid barrel insert.
    translate([0, 0, -body_h/2 - barrel_insert_stop_h/2])
      cylinder(d = barrel_insert_stop_d, h = barrel_insert_stop_h, center = true);
    barrel_insert(-body_h/2 - barrel_insert_stop_h);
  }
}

module internal_cutouts() {
  // Empty service cavity inside the cylinder.
  translate([0, 0, internal_cavity_z])
    cylinder(d = internal_cavity_d, h = internal_cavity_h, center = true);

  // Exact 26x15x14mm imported LR44x3 holder clearance at the lower side.
  imported_battery_holder(extra_clearance = 0.35);

  // Wire channel from battery pocket to empty electronics cavity.
  translate([0, 0, battery_pocket_z_center + battery_pocket_z/2 + 1.0])
    cylinder(d = battery_wire_channel_d, h = 6.0, center = true);

  // Internal 6mm x 10mm laser socket under the outside face.
  translate([0, 0, body_h/2 - shell_wall - laser_socket_depth/2])
    cylinder(d = laser_d + laser_clearance, h = laser_socket_depth, center = true);

  // Outside has only the small beam aperture.
  translate([0, 0, body_h/2 - 0.7])
    cylinder(d = beam_aperture_d, h = 2.0, center = true);

  // Wire pass-through from laser socket into the empty cavity.
  translate([0, 0, body_h/2 - shell_wall - laser_socket_depth - 2.0])
    cylinder(d = laser_wire_channel_d, h = 6.0, center = true);
}

module body_with_features() {
  union() {
    difference() {
      union() {
        solid_outer_body();
        perfboard_bosses();
      }

      internal_cutouts();
      perfboard_pilot_holes();
    }

    // Battery holder is NOT added here. It remains one whole imported part and
    // the clamshell only has a clearance pocket for it.
  }
}

module screw_holes_for_lid() {
  for (point = join_points) {
    translate([point[0], -body_d/2 + 8.0, point[1]]) rotate([90, 0, 0])
      cylinder(d = join_screw_clearance_d, h = body_d, center = true);
    translate([point[0], -body_d/2 + 0.6, point[1]]) rotate([90, 0, 0])
      cylinder(d = join_head_d, h = 2.0, center = true);
  }
}

module screw_holes_for_base() {
  for (point = join_points) {
    translate([point[0], body_d/2 - 8.0, point[1]]) rotate([90, 0, 0])
      cylinder(d = join_screw_pilot_d, h = body_d, center = true);
  }
}

module base_clip() {
  translate([0, body_d/4 + split_gap/2, 0])
    cube([body_d + 20, body_d/2, body_h + barrel_insert_len + 20], center = true);
}

module lid_clip() {
  translate([0, -body_d/4 - split_gap/2, 0])
    cube([body_d + 20, body_d/2, body_h + barrel_insert_len + 20], center = true);
}

module base_half() {
  intersection() {
    difference() {
      body_with_features();
      screw_holes_for_base();
    }
    base_clip();
  }
}

module lid_half() {
  intersection() {
    difference() {
      body_with_features();
      screw_holes_for_lid();
    }
    lid_clip();
  }
}

module insert_test() {
  union() {
    translate([0, 0, barrel_insert_stop_h/2])
      cylinder(d = barrel_insert_stop_d, h = barrel_insert_stop_h, center = true);
    barrel_insert(0);
  }
}

if (part == "base_half") {
  base_half();
} else if (part == "lid_half") {
  lid_half();
} else if (part == "battery_holder") {
  imported_battery_holder(extra_clearance = 0);
} else if (part == "insert_test") {
  insert_test();
} else if (part == "assembly") {
  translate([0, assembly_gap/2, 0]) base_half();
  translate([0, -assembly_gap/2, 0]) lid_half();
  imported_battery_holder(extra_clearance = 0);
}
