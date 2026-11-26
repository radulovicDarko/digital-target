# Laser Range RTSP Test

## Pokretanje
1. Aktiviraj virtual environment
2. Instaliraj dependencies:
   pip install -r requirements.txt
3. Pokreni:
   python app.py

## Komande
- q = izlaz
- a = toggle auto-align
- n = freeze/unfreeze trenutnog poravnanja (potvrdi kalibraciju)
- r = reset rezultata
- + / -      = scale up/down (ringovi veći/manji za 0.5%)
- h / l      = pomeri centar levo / desno (0.5 mm)
- k / j      = pomeri centar gore / dole (0.5 mm)
- , / .      = rotacija ±0.5°
- [ / ]      = aspect ratio Y/X ±0.5%
- 0          = reset svih ručnih tweaks-a (scale=1.0, offset=0, rot=0, aspect=1.0)

Tweaks (scale + offset) se automatski snimaju u `calibration_tweaks.json`
i učitavaju pri svakom startu — kada jednom pogodiš veličinu i centar,
ne moraš više nikad to da radiš.

## Mobile control server
Python app pri startu pokreće HTTP server (default `0.0.0.0:8080`) koji
React Native mobile aplikacija koristi za pairing, live preview i kalibraciju.

Endpoints:
- `GET  /api/health`              — health check (pairing probe)
- `POST /api/pair`                — vraća dev token (no real auth)
- `GET  /api/stream/preview.mjpeg` — MJPEG stream anotirane slike (isto kao cv2 prozor)
- `POST /api/calibration/freeze`   — programatska zamena za pritisak `n` (zaledi)
- `POST /api/calibration/unfreeze` — odledi

Konfigurabilno u `config.py` (`CONTROL_SERVER_*`, `MJPEG_QUALITY`, `AUTH_TOKEN`).

### Raspberry Pi 5 + Camera Module 3 + Wi-Fi AP
- Postavi Pi kao AP (npr. NetworkManager hotspot ili `hostapd`).
- Tipične AP IP adrese koje mobile aplikacija probova: `192.168.4.1`,
  `192.168.42.1`, `10.42.0.1`, `shooterrange.local` — sve probava i na
  portu `8080` i na `80`.
- Ako želiš port 80 (bez `:8080` u URL), pokreni Python sa pravima ili
  proksiraj kroz `nginx`/`socat`. Najjednostavnije: ostavi 8080.
- U mobilnoj aplikaciji koristi auto-discovery ili "Manual IP" → `192.168.4.1`.

## Ako stream ne radi
- Testiraj URL u VLC
- Probaj RTSP_TRANSPORT = "tcp"
- Probaj USE_FFMPEG = False

## Temporalni detektor lasera

Detekcija vise ne koristi HSV kao osnovu. `core/detector.py` prati grayscale
background i pozitivan porast svetline u ROI-ju, koristi Otsu sa minimum-difference
floor-om, opening/closing, area/circularity filtere i potvrdu bliskih kandidata
u uzastopnim kadrovima. Cooldown pocinje tek nakon prihvacenog, ocenjenog pogotka.
Za novi pogodak potrebno je i nestajanje prethodnog bljeska.

Podesavanja su u `config.py`:
- `DETECTOR_ROI`: `(x, y, width, height)` u originalnim pikselima; `None` koristi
  papir iz fixed-center kalibracije ili legacy/homography geometrije.
- `DETECTOR_MIN_DIFF=20`, `BACKGROUND_ALPHA=0.005` (sa `DETECTOR_` prefiksom),
  area `8..2500`, circularity `0.35`: pocetne vrednosti za tuning, ne univerzalna garancija.
- `DETECTOR_CONFIRMATION_FRAMES=2`, radius `15` px, cooldown `8` kadrova,
  clear `2` i warmup `5` kadrova. Na 30 FPS dva kadra mogu propustiti vrlo
  kratak impuls; prvo izmeriti trajanje stvarnog lasera i capture FPS.
- `DETECTOR_RED_VALIDATION_ENABLED=True`: sekundarni BGR red-dominance filter,
  sa prihvatanjem zasicenog belog jezgra. Iskljuciti za odgovarajuci necrveni izvor.
- `DETECTOR_GAUSSIAN_REFINEMENT_ENABLED=True`: lokalni log-Gaussian fit.
  Rank, oblik, residual i pomeraj se proveravaju; nevalidan/zasicen fit koristi
  intensity-weighted centroid sa vidljivim debug razlogom.
- `SHOT_COOLDOWN_MS` je legacy konstanta; temporalni detektor koristi frame cooldown,
  bez prikrivenog dodatnog ms debounce-a.

Pri startup-u meta treba da bude prazna i mirna. Background se ne uci tokom
kandidata/cooldown-a. Promene ROI-ja, fokusa, dimenzija i globalna nestabilnost
resetuju model. Globalna promena scene invalidira homografiju; ako se kamera
fizicki pomerila, proveriti i fixed-center kalibraciju.

### Kamera

Picamera2 koristi manual AE/WB po default-u: `CAMERA_EXPOSURE_US` u mikrosekundama,
`CAMERA_ANALOGUE_GAIN` i `CAMERA_COLOUR_GAINS=(red_gain, blue_gain)`.
Pocetnih 8000 us i gain 1.0 nisu automatska kalibracija: podesiti na praznom papiru,
sa vidljivim detaljima, bez clipping-a, i ekspozicijom kracom od frame intervala.
Env overrides: `SHOOTERRANGE_CAMERA_AE`, `SHOOTERRANGE_CAMERA_AWB`,
`SHOOTERRANGE_CAMERA_EXPOSURE_US`.

Trazene kontrole i stvarna metadata prikazuju se u detector statusu/debug-u.
Nepodrzane kontrole daju eksplicitnu gresku. FFmpeg RTSP prijemnik ne moze da
kontrolise udaljenu kameru: exposure/WB moraju biti zakljucani na izvoru.
Ne postoji dodatni OpenCV VideoCapture backend.

Temporalni pipeline po default-u fokusira samo na startup-u (`PICAM_AF_MODE=once`),
da periodicni autofocus ne invalidira background/homografiju tokom sesije.
`SHOOTERRANGE_PICAM_AF_MODE` i dalje dozvoljava `auto`, `continuous` ili `off`.
Posle promene LensPosition vece od `CAMERA_LENS_RESET_DELTA` model se resetuje;
za trajno kesiranu homografiju potrebno je stabilno, isto fokusiranje.

Picamera2 `RGB888` daje numpy `[B,G,R]`, a `BGR888` `[R,G,B]`; za OpenCV je
izabran `RGB888`, prema [zvanicnom Picamera2 prirucniku](https://pip.raspberrypi.com/documents/RP-008156-DS-picamera2-manual.pdf).

### ROI, reference i debug

Na mobilnom Calibration ekranu nova sekcija omogucava:
- vidljivo pozicioniranje sa automatskom ekspozicijom/WB i fokusiranjem, bez pogodaka;
- brisanje zutih preview oznaka bez brisanja istorije, bodova ili cooldown-a;
- reset prazne pozadine i ukljucivanje/iskljucivanje debug-a;
- izbor ROI-ja dodirivanjem dva suprotna ugla na zamrznutom originalnom kadru;
- izbor cetiri reference redosledom prikazanih target-mm koordinata;
- recalibration iz ArUco markera i eksplicitan izbor fixed-center/homography rezima.

Ulazak u kalibraciju na Picamera2 ukljucuje pozicioniranje. Sacekati jasnu i stabilnu
sliku, poravnati praznu metu, zatim izabrati "Zakljucaj i pokreni detekciju".
Zakljucavanje zadrzava izmereni WB/fokus, vraca konfigurisan kratki shutter/gain,
zakljucava geometrijske izmene i resetuje temporalnu pozadinu. Preview tada moze
biti taman; za novu proveru ili pomeranje izabrati "Pozicioniraj metu".
Model ceka tri uzastopna kadra sa izmerenom kratkom ekspozicijom, gain-om, WB/fokusom,
pa tek tada uci pozadinu; queued AE kadrovi ne registruju pogotke niti kvarenje
homografije pri prelazu. Posle 5s bez stabilnih kontrola status prijavljuje gresku;
ponoviti pozicioniranje/zakljucavanje. Potvrda ceka stanje `ready`. Rezim ne pokrece niti
brise trening sesiju. RTSP nema ove kontrole; izvornu kameru podesiti spolja.

Fixed-center koristi fiksne prstenove: fizicki poklopiti metu sa overlay-em ili
kalibrisati cetiri reference i koristiti homografiju za perspektivu/razmeru.
Za kutiju snimljenu 26.11.2026. `fixed_calibration.json` postavlja centar
na priblizno (448.75, 255.74) u kadru 960x540. Opcioni `geometry` profil
ispravlja perspektivu, odnos osa, shear i radijalnu deformaciju objektiva.
Overlay, bodovanje i granice automatskog ROI-ja koriste isto mapiranje;
bez profila ostaje raniji kruzni fixed-center model.
Raspored je umanjena ISSF pistolj meta, uz **nepotvrdjenu pretpostavku**
da je spoljni krug 83 mm. Izmeriti stampu pre provere tacnosti u mm;
ako precnik nije 83 mm, promeniti fizicke precnike u `config.py` i
proporcionalno promeniti `mm_per_px`. Profil vazi samo za isti polozaj mete,
kamere, fokus i dimenzije kadra. Nevalidan sacuvani profil ili druge dimenzije
se eksplicitno odbijaju, bez tihog prelaska na nekorigovano bodovanje.
Fit na originalnim kadrovima smanjuje odstupanje linija; debljina stampe,
sum i deformacija papira onemogucavaju garanciju "100%" fizicke tacnosti.
Windows deploy sa `.\deploy.ps1 -IncludeFixedCalibration` eksplicitno prenosi
ovu kalibraciju, proverava checksum i cuva prethodnu u rollback backup-u.
Bez tog parametra postojeca kalibracija uredjaja ostaje netaknuta.
Deploy izvrsava udaljenu skriptu iz datoteke (ne iz stdin-a podprocesa),
ponavlja checksum/health proveru posle restarta i, uz `-ResultPath`,
snima udaljeni izlaz u dodatnu `.log` datoteku.
Legacy klizaci i Auto adjust ne menjaju fixed-center bodovanje, pa se prikazuju
samo u legacy rezimu. `calibrated` u detector status-u oznacava homografiju,
ne potvrdu operatera; za potvrdu sluze `alignment_locked` i `capture_mode`.

Editor je namerno neuvecan, prikazuje ceo originalni kadar bez `cover` crop-a.
Postojeci zoom/pan live preview ostaje nepromenjen. Za novu referentnu sliku
otkazati editor i otvoriti ga ponovo. Server odbija zastarele dimenzije/version.
`detector_calibration.json` cuva ROI, reference, mapping mode i invalidation
odvojeno od `fixed_calibration.json` i `calibration_tweaks.json`.
Ostecena nova calibration datoteka eksplicitno blokira registraciju dok se
ne sacuva nova validna ROI/reference konfiguracija; ne prelazi tiho na fixed-center.

ArUco zahteva podesene `ARUCO_REFERENCE_POINTS_MM` (ID -> poznati mm polozaj)
i `ARUCO_DICTIONARY`. Markeri moraju biti vidljivi kameri; za kameru iza papira
prednji markeri mogu biti necitljivi, pa koristiti rucne reference ili fixed-center.
RANSAC prag je `HOMOGRAPHY_RANSAC_MM`, u destination mm jedinicama; zasebni
`HOMOGRAPHY_MAX_REPROJECTION_PX` ogranicava gresku u originalnim pikselima.
Tacno cetiri korespondencije ne daju pouzdanu outlier otpornost. U homography
rezimu nevalidna kalibracija blokira pogodak, bez tihog prelaska na drugi scoring.
World references definisu orijentaciju: nema dodatnog fixed-center mirror-a.

Keyboard: `c` reset background-a, `v` toggle debug-a; postojeci tasteri ostaju.
Debug prikazuje ROI/contours/centroid, razloge odbijanja, difference/raw/clean mask,
stanje detektora, exposure/WB i poslednji score/distance.

REST dodatak (isti control server):
- `GET /api/detector/status`
- `GET /api/detector/snapshot.jpg` — originalni kadar za editor
- `POST /api/detector/background/reset`
- `POST /api/detector/debug` — `{"enabled": true}`
- `POST /api/detector/capture-mode` — `{"mode": "alignment"}` ili `"detection"`
- `POST /api/detector/preview/clear` — samo zute oznake; odgovor sadrzi `preview_hits`
- `POST /api/detector/calibration` — `frame_size`, `version`, opciono `roi`,
  `image_points`, `mapping_mode`
- `POST /api/detector/calibration/aruco`

Mutacije se izvrsavaju na capture thread-u. HTTP 200 znaci da je komanda primenjena;
400 oznacava nevalidan input, 503 nedostupnu kameru/kontrolu, 504 izostalu potvrdu
capture thread-a. Demo/mock bez kamere eksplicitno prijavljuje unavailable.
WS hit payload i mobilno trajno skladistenje nisu menjani.

### Provera i materijal mete

```powershell
python -m unittest discover -s .\tests -p test_temporal.py -v
```

Suite ukljucuje postojece scoring testove, synthetic pulses/noise/glare,
subpixel centroid, ROI/mapping, camera controls i capture-to-hit/debug integraciju.
Poruka `Invalid detector calibration: 'target_size'` tokom suite-a potice od
namerno ostecenog fixture-a. U produkciji proveriti `GET /api/detector/status`:
isti problem u stvarnoj datoteci blokira registraciju dok se ne popravi kalibracija.
Stvarnu tacnost proveriti oznacenim impulsima u svetloj i tamnoj sceni:
cilj najmanje 20 impulsa po sceni, >=95% registrovanih i bez duplih pogodaka.
Bez snimaka ili fizickih impulsa ovo nije dokazano samo synthetic testovima.

Koristiti mat beli/svetlosivi papir ili probni mat overlay, difuzno stalno svetlo,
izbegavati direktne refleksije i fiksirati kameru/metu. Zasicenje i lokalni odsjaj
istog oblika/trajanja kao laser ne mogu se potpuno resiti softverom. Opticki
filter/NoIR zahteva odgovarajucu opremu i sertifikovan eye-safe izvor; ne pojacavati
laser i ne koristiti nezasticen nevidljiv snop.

### Deploy sa Windowsa

`deploy.ps1` koristi Windows SSH/SCP/tar, pravi backup aktivnog koda, proverava
archive/install hashes i testove pre restarta. Lozinke se unose samo u terminalu.
Cuva postojeci venv, runtime kalibracije i systemd konfiguraciju/environment.

```powershell
.\deploy.ps1 -Target admin@192.168.1.194 -RemoteDir /home/admin/smokeless-range-software -ServiceName etarget
```

Za Bash deploy servis se moze izabrati preko `SERVICE_NAME=etarget`; podrazumevani
stari naziv `shooterrange` ostaje kompatibilan. Ne pokretati drugi servis za isti port.