/**
 * electron-builder `afterPack` hook.
 *
 * The Windows build sets `signAndEditExecutable: false` to avoid the
 * winCodeSign symlink-privilege failure on machines without Developer Mode.
 * That flag also skips electron-builder's normal step of embedding the app
 * icon into the packaged .exe — so the installed executable (and therefore the
 * desktop / Start-menu shortcut) falls back to Electron's default icon.
 *
 * This hook embeds build/icon.ico directly using the standalone `rcedit`
 * binary (bundled with the `rcedit` npm package), which edits PE resources in
 * place and needs no code-signing tooling (no winCodeSign download). It runs
 * after the app is unpacked into `win-unpacked/` and before the NSIS installer
 * packages it, so the installer ships the icon-bearing exe.
 */
const path = require('node:path');
const fs = require('node:fs');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const projectDir = context.packager.projectDir;
  const iconPath = path.join(projectDir, 'build', 'icon.ico');

  if (!fs.existsSync(exePath)) {
    console.warn(`[afterPack] exe not found, skipping icon embed: ${exePath}`);
    return;
  }
  if (!fs.existsSync(iconPath)) {
    console.warn(`[afterPack] icon not found, run "npm run gen:icon": ${iconPath}`);
    return;
  }

  // `rcedit` v5 is ESM-only, so load it with a dynamic import from this CJS hook.
  const { rcedit } = await import('rcedit');
  console.log(`[afterPack] embedding company logo into ${exeName}`);
  await rcedit(exePath, { icon: iconPath });
};
