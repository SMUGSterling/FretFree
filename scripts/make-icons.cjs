// Draws the app icons (PNG) from icons/icon.svg and icons/maskable.svg with a headless Chromium. The PNGs are
// committed; run this only after changing an SVG: node scripts/make-icons.cjs  (CHROMIUM_PATH picks a browser)
const fs = require('node:fs'),
  path = require('node:path'),
  {chromium} = require('playwright');
const dir = path.join(__dirname, '..', 'icons');
// [source SVG, output PNG, size]. Maskable icons fill the square edge to edge, since the platform crops them; iOS
// rounds the corners of apple-touch-icon itself, so it uses the same full-bleed artwork.
const ICONS = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['maskable.svg', 'maskable-512.png', 512],
  ['maskable.svg', 'apple-touch-icon.png', 180]
];
(async () => {
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH
      ? {executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage']}
      : {}
  );
  for (const [source, output, size] of ICONS) {
    const page = await browser.newPage({viewport: {width: size, height: size}});
    const svg = fs.readFileSync(path.join(dir, source), 'utf8');
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
    );
    await page.screenshot({path: path.join(dir, output), omitBackground: true});
    await page.close();
    console.log(`icons/${output} (${size}×${size})`);
  }
  await browser.close();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
