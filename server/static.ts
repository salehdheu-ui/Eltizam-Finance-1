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
    index: false,
    setHeaders: (res, filePath) => {
      // Vite fingerprints everything under /assets, so those URLs can never
      // point at different bytes and are safe to keep forever. Anything else —
      // index.html above all — must be rechecked, or a deploy keeps serving the
      // old page and with it the old bundle reference.
      const isFingerprinted = filePath.includes(`${path.sep}assets${path.sep}`);
      res.setHeader("Cache-Control", isFingerprinted ? "public, max-age=31536000, immutable" : "no-cache");
    },
  }));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
