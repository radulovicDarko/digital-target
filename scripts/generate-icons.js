/* eslint-disable no-console */
/**
 * Build the PNG bundle Expo needs from pre-generated AppIcons.
 *
 * Source layout (from an icon generator like appicon.co):
 *   assets/appicons/appstore.png                              1024x1024 (iOS App Store)
 *   assets/appicons/playstore.png                             512x512  (Play Store)
 *   assets/appicons/Assets.xcassets/AppIcon.appiconset        iOS sizes
 *   assets/appicons/android/mipmap-(hdpi|mdpi|...)            Android sizes
 *
 * Outputs (re-run any time the source set changes):
 *   assets/icon.png                  iOS / Expo, 1024 RGB (no alpha)
 *   assets/adaptive-icon.png         Android adaptive foreground, 1024 RGBA
 *   assets/favicon.png               web, 196 RGBA
 *   assets/splash.png                splash logo, 1242 RGBA
 *   assets/notification-icon.png     Android notification, 192 RGBA
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'assets', 'appicons');
const SRC_IOS_1024 = path.join(SRC_DIR, 'appstore.png');
const SRC_IOS_FALLBACK = path.join(
  SRC_DIR,
  'Assets.xcassets',
  'AppIcon.appiconset',
  '1024.png',
);
const SRC_PLAY = path.join(SRC_DIR, 'playstore.png');
const OUT = path.join(ROOT, 'assets');

const BG = '#0B0F14';

if (!fs.existsSync(SRC_DIR)) {
  console.error(`Source folder not found: ${SRC_DIR}`);
  process.exit(1);
}

const pickIos1024 = () =>
  fs.existsSync(SRC_IOS_1024) ? SRC_IOS_1024 : SRC_IOS_FALLBACK;

async function build() {
  const ios1024 = pickIos1024();
  const playSrc = fs.existsSync(SRC_PLAY) ? SRC_PLAY : ios1024;

  // 1. iOS app icon — flattened to opaque RGB on the brand background.
  await sharp(ios1024)
    .flatten({ background: BG })
    .removeAlpha()
    .resize(1024, 1024, { fit: 'contain', background: BG })
    .png()
    .toFile(path.join(OUT, 'icon.png'));
  console.log('✓ icon.png (1024×1024 RGB)');

  // 2. Android adaptive icon foreground. The logo lives inside the inner
  //    66% of the canvas (Android masks/scales the rest), so we compose it
  //    on a transparent square with padding.
  const FG_SIZE = 1024;
  const FG_INNER = Math.round(FG_SIZE * 0.7);
  const FG_PAD = Math.round((FG_SIZE - FG_INNER) / 2);
  const fgLogo = await sharp(playSrc)
    .resize(FG_INNER, FG_INNER, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: FG_SIZE,
      height: FG_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: fgLogo, left: FG_PAD, top: FG_PAD }])
    .png()
    .toFile(path.join(OUT, 'adaptive-icon.png'));
  console.log('✓ adaptive-icon.png (1024×1024 transparent, 70% safe area)');

  // 3. Web favicon.
  await sharp(playSrc).resize(196, 196).png().toFile(path.join(OUT, 'favicon.png'));
  console.log('✓ favicon.png (196×196)');

  // 4. Splash logo. Expo centres this on `splash.backgroundColor`.
  const SPLASH_SIZE = 1242;
  const SPLASH_INNER = Math.round(SPLASH_SIZE * 0.45);
  const splashLogo = await sharp(ios1024)
    .resize(SPLASH_INNER, SPLASH_INNER, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: SPLASH_SIZE,
      height: SPLASH_SIZE,
      channels: 4,
      background: BG,
    },
  })
    .composite([
      {
        input: splashLogo,
        left: Math.round((SPLASH_SIZE - SPLASH_INNER) / 2),
        top: Math.round((SPLASH_SIZE - SPLASH_INNER) / 2),
      },
    ])
    .flatten({ background: BG })
    .removeAlpha()
    .png()
    .toFile(path.join(OUT, 'splash.png'));
  console.log('✓ splash.png (1242×1242 RGB)');

  // 5. Notification icon (Android).
  await sharp(playSrc).resize(192, 192).png().toFile(path.join(OUT, 'notification-icon.png'));
  console.log('✓ notification-icon.png (192×192)');
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
