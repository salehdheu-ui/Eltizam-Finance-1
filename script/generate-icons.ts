import { chromium } from "playwright-core";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

/**
 * Renders the app icons from one source design so every size stays identical in
 * shape and colour. Home screen icons are the app's face once it is installed,
 * and eyeballing four separately drawn files into agreement never holds.
 *
 * Run with `npm run icons` after changing the design below.
 */

const BRAND = "hsl(221 83% 53%)";
const BRAND_DEEP = "hsl(224 76% 40%)";

/**
 * `padding` is the share of the canvas left empty around the mark. Android crops
 * a maskable icon to whatever shape the launcher uses, so that variant keeps the
 * mark well inside the safe circle while the plain one fills its tile.
 */
function iconMarkup(options: { size: number; padding: number; rounded: boolean }) {
  const { size, padding, rounded } = options;
  const inner = size * (1 - padding * 2);

  return `<!DOCTYPE html>
<html dir="rtl">
  <head>
    <meta charset="utf-8" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@800;900&display=swap" rel="stylesheet" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${size}px; height: ${size}px; }
      body { display: flex; align-items: center; justify-content: center; background: transparent; }
      .tile {
        width: ${size}px;
        height: ${size}px;
        border-radius: ${rounded ? size * 0.22 : 0}px;
        background: linear-gradient(145deg, ${BRAND} 0%, ${BRAND_DEEP} 100%);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .mark {
        width: ${inner}px;
        height: ${inner}px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'Tajawal', sans-serif;
        font-weight: 900;
        color: #fff;
        /* Sized against the mark box rather than the tile so the maskable
           variant shrinks its text along with its safe area. */
        font-size: ${inner * 0.3}px;
        letter-spacing: -0.01em;
        line-height: 1;
      }
    </style>
  </head>
  <body><div class="tile"><div class="mark">التزام</div></div></body>
</html>`;
}

const TARGETS = [
  { file: "icon-192.png", size: 192, padding: 0.14, rounded: true },
  { file: "icon-512.png", size: 512, padding: 0.14, rounded: true },
  // Full-bleed background, mark inside the safe circle: Android crops this one.
  { file: "icon-maskable-512.png", size: 512, padding: 0.22, rounded: false },
  { file: "apple-touch-icon.png", size: 180, padding: 0.14, rounded: false },
];

async function generate() {
  const outputDirectory = path.resolve("client/public/icons");
  await mkdir(outputDirectory, { recursive: true });

  const browser = await chromium.launch({
    // The environment ships one Chromium at a fixed path; the revision Playwright
    // would otherwise look for is not downloaded here.
    executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  });
  try {
    for (const target of TARGETS) {
      const page = await browser.newPage({
        viewport: { width: target.size, height: target.size },
        deviceScaleFactor: 1,
      });
      await page.setContent(iconMarkup(target), { waitUntil: "networkidle" });
      // The wordmark is the icon; rendering it before the webfont resolves would
      // silently ship a fallback face.
      await page.evaluate(() => document.fonts.ready);
      const buffer = await page.screenshot({ omitBackground: true });
      await writeFile(path.join(outputDirectory, target.file), buffer);
      await page.close();
      console.log(`wrote icons/${target.file} (${target.size}px)`);
    }
  } finally {
    await browser.close();
  }
}

generate().catch((error) => {
  console.error("Icon generation failed:", error);
  process.exit(1);
});
