# Dry-Fire Laser PCB — EasyEDA Instructions

## Files

- **schematic.svg** — open in browser. Visual schematic to copy into EasyEDA.
- **pcb-layout-35mm.svg** — 35mm round PCB placement guide.

## EasyEDA step-by-step

1. Go to [easyeda.com/editor](https://easyeda.com/editor) → "STD Edition" (free, no install).
2. **File → New → Project**, name it `dry-fire-laser`.
3. **New Schematic.** Open `schematic.svg` in browser as reference, side by side.

### Components to place (Place → Library)

| Reference | Search in EasyEDA | Footprint |
|---|---|---|
| U1 | `ATtiny85-20PU` | DIP-8 |
| C1 | `100nF` ceramic | 0805 SMD or radial 2.54mm |
| S1 | `SS12D10` | through-hole 3-pin |
| J1 (Laser) | `Header-2P-2.54` | 2-pin pin header |
| J2 (Trigger) | `Header-2P-2.54` | 2-pin pin header |
| J3 (ISP, optional) | `Header-6P-2.54` | 6-pin pin header |
| BT1 (battery PLACEHOLDER) | `Header-2P-2.54` | 2-pin pin header, label "BAT+/GND" |

> The battery + TP4056 + protection are intentionally LEFT AS A PLACEHOLDER (2-pin header). The PCB manufacturer/designer will add the actual battery holder, charger, and protection circuit when they finalize the board for production.

### Wiring (drag wires between pins)

```
VCC net:   BT1.+ → S1.pin2 → S1.pin3 → U1.pin8 → C1.+ → J3.VCC
GND net:   BT1.− → U1.pin4 → C1.− → J1.L− → J2.T2 → J3.GND
LASER net: U1.pin6 (PB1) → J1.L+
TRIG net:  U1.pin5 (PB0) → J2.T1
RST net:   U1.pin1 → J3.RST   (only if ISP header used)
```

### Convert to PCB

1. **Design → Convert Schematic to PCB**.
2. **Board Outline:** Top toolbar → set "Board Outline" layer → draw **circle Ø 35mm**.
3. Drag components into place using `pcb-layout-35mm.svg` as guide:
   - U1 center
   - C1 next to U1 pins 4 + 8
   - S1 top
   - BT1 placeholder bottom (large empty area for designer)
   - J1 (laser) right edge
   - J2 (trigger) left edge
4. **Route** with "T" key (or auto-route: Route → Auto Route). Manual route is cleaner for this simple board.
5. **Add ground pour:** Place → Solid Region → select GND net → fill both top and bottom layers.

### Export Gerber

1. **Fabrication → PCB Order (Gerber)** → Generate Gerber.
2. Download ZIP.
3. Send ZIP to your Serbian PCB house — they'll confirm and quote.

## Specs to give the PCB manufacturer

- **Shape:** Round, 35mm diameter
- **Layers:** 2 (top + bottom)
- **Thickness:** 1.6mm standard
- **Min trace/space:** 0.2mm (easy)
- **Battery + charger + protection:** PLEASE ADD (2-pin BAT+/GND placeholder on board). Use 18650 cell, TP4056 1A Type-C charger, with standard 18650 protection IC.
- **Surface finish:** HASL (cheapest) or ENIG if available

## Bill of Materials (you supply or PCB house assembles)

| Qty | Part | Note |
|---|---|---|
| 1 | ATtiny85-20PU DIP-8 | already programmed via Arduino-as-ISP |
| 1 | DIP-8 socket | strongly recommended |
| 1 | 100nF ceramic capacitor | decoupling |
| 1 | SS12D10 slide switch | on/off |
| 1 | 2-pin header for LASER | 2.54mm |
| 1 | 2-pin header for TRIGGER | 2.54mm |
| 1 | 6-pin header for ISP (optional) | 2.54mm — for reflashing |
| 1 | 18650 cell + holder + TP4056 + protection | PCB designer adds |

## Important warnings

- **18650 voltage = 3.0–4.2V.** ATtiny85 OK (1.8–5.5V range).
- **Test that your laser module works at 3.7V** before ordering. If not, add a boost converter (3.7V → 5V) for laser only — tell PCB designer.
- **Never connect 9V to U1** — chip will die instantly.
- Switch is in **OUT+ line** (after charger) so battery can charge while switch is off.
