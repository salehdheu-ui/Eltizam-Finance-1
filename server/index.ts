import express, { type Request, Response, NextFunction } from "express";
import { ensureUserAdminColumns, ensureUserEmailUniqueIndex, ensureUserPhoneColumns, ensureUserPhoneUniqueIndex, ensureVariableObligationMonthStatusesTable, initializeDatabase } from "./db";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);
const isProduction = process.env.NODE_ENV === "production";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

function buildApiLogPayload(bodyJson: unknown, statusCode: number) {
  if (!bodyJson || typeof bodyJson !== "object") {
    return undefined;
  }

  const bodyRecord = bodyJson as Record<string, unknown>;
  const message = typeof bodyRecord.message === "string" ? bodyRecord.message : undefined;

  return JSON.stringify({
    statusCode,
    message,
    keys: Object.keys(bodyRecord).slice(0, 8),
  });
}

function isTrustedRequestSource(req: Request) {
  const originHeader = req.get("origin");
  const refererHeader = req.get("referer");

  if (!originHeader && !refererHeader) {
    return true;
  }

  const forwardedProto = req.get("x-forwarded-proto");
  const requestProtocol = (forwardedProto || req.protocol || "http").split(",")[0].trim();
  const requestHost = req.get("host");

  if (!requestHost) {
    return false;
  }

  const expectedOrigin = `${requestProtocol}://${requestHost}`;

  try {
    if (originHeader) {
      return new URL(originHeader).origin === expectedOrigin;
    }

    if (refererHeader) {
      return new URL(refererHeader).origin === expectedOrigin;
    }

    return false;
  } catch {
    return false;
  }
}

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

app.use((req, res, next) => {
  const unsafeMethods = new Set(["POST", "PATCH", "PUT", "DELETE"]);

  if (!req.path.startsWith("/api") || !unsafeMethods.has(req.method)) {
    next();
    return;
  }

  if (!isTrustedRequestSource(req)) {
    return res.status(403).json({ message: "مصدر الطلب غير موثوق" });
  }

  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      const payload = buildApiLogPayload(capturedJsonResponse, res.statusCode);
      if (payload) {
        logLine += ` :: ${payload}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  app.set("trust proxy", 1);
  initializeDatabase();
  ensureUserPhoneColumns();
  ensureUserAdminColumns();
  ensureUserEmailUniqueIndex();
  ensureUserPhoneUniqueIndex();
  ensureVariableObligationMonthStatusesTable();
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = isProduction && status >= 500
      ? "حدث خطأ داخلي غير متوقع"
      : err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
