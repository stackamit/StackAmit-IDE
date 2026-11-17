// Generates Windows/web app icons from the company logo (assets/logo.jpg).
// Produces build/icon.png (1024²), build/icon.ico (multi-size) and a web
// favicon (public/favicon.png, 64²). The logo is padded (not cropped) onto a
// transparent square so nothing is clipped. Run via `npm run gen:icon`.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const pngToIcoMod = require('png-to-ico');
const pngToIco = pngToIcoMod.default || pngToIcoMod;

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(clientDir, '..', 'assets', 'logo.jpg');
const buildDir = path.join(clientDir, 'build');
const publicDir = path.join(clientDir, 'public');

if (!fs.existsSync(src)) {
  console.error(`[gen:icon] source logo not found: ${src}`);
  process.exit(1);
}
fs.mkdirSync(buildDir, { recursive: true });

// Center the logo on a transparent square canvas, preserving aspect ratio.
const square = (size) =>
  sharp(src)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png();

await square(1024).toFile(path.join(buildDir, 'icon.png'));

// Build a BMP-encoded multi-size ICO (NSIS rejects PNG-compressed ICO entries,
// which is what sharp's native .ico writer emits).
const pngSizes = [256, 128, 64, 48, 32, 24, 16];
const pngs = await Promise.all(
  pngSizes.map((s) =>
    sharp(src)
      .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer(),
  ),
);
fs.writeFileSync(path.join(buildDir, 'icon.ico'), await pngToIco(pngs));

await square(64).toFile(path.join(publicDir, 'favicon.png'));

console.log('[gen:icon] wrote build/icon.png, build/icon.ico, public/favicon.png');
