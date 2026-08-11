import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath, {
    setHeaders: (res, filePath) => {
      const fileName = path.basename(filePath);

      // These three decide what every future visit loads. Cached by a proxy, a
      // superseded worker or shell keeps serving the old app and there is no way
      // for a deploy to reach the user. index.html is included because
      // express.static answers "/" with it before the fallback below can.
      if (fileName === "sw.js" || fileName === "manifest.webmanifest" || fileName === "index.html") {
        res.setHeader("Cache-Control", "no-cache, must-revalidate");
        return;
      }

      // Vite writes a content hash into these names, so the bytes behind a given
      // URL can never change and revalidating them is pure latency.
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  }));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (_req, res) => {
    // The shell names the current asset bundle, so holding it even briefly serves
    // a deploy the assets it points at no longer match.
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
