import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { writeAuditEvent } from "./audit";
import { User as SelectUser } from "@shared/schema";
import { z } from "zod";

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

const scryptAsync = promisify(scrypt);
const isProduction = process.env.NODE_ENV === "production";
const derivedSessionSecret = process.env.SESSION_SECRET || (!isProduction ? randomBytes(32).toString("hex") : "");
const loginRateLimitWindowMs = 10 * 60 * 1000;
const loginRateLimitMaxAttempts = 5;
const sessionCookieName = "eltizam.sid";
const authAttempts = new Map<string, { count: number; windowStartedAt: number }>();

const passwordSchema = z.string()
  .min(8)
  .max(128)
  .regex(/[A-Z]/, "يجب أن تحتوي كلمة المرور على حرف كبير واحد على الأقل")
  .regex(/[a-z]/, "يجب أن تحتوي كلمة المرور على حرف صغير واحد على الأقل")
  .regex(/[0-9]/, "يجب أن تحتوي كلمة المرور على رقم واحد على الأقل");

const registerSchema = z.object({
  username: z.string().min(3).max(50),
  password: passwordSchema,
  name: z.string().min(1).max(120).optional(),
  fullName: z.string().min(1).max(120).optional(),
  email: z.string().email(),
});

const loginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(128),
});

const updateUserSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: "لا توجد بيانات صالحة للتحديث",
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

function regenerateSession(req: Express.Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function loginUser(req: Express.Request, user: SelectUser) {
  return new Promise<void>((resolve, reject) => {
    req.login(user, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function logoutUser(req: Express.Request) {
  return new Promise<void>((resolve, reject) => {
    req.logout((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function destroySession(req: Express.Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.destroy((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function getRateLimitKey(identifier: string, ipAddress: string | undefined) {
  return `${identifier}:${ipAddress || "unknown"}`;
}

function consumeAuthAttempt(key: string) {
  const now = Date.now();
  const current = authAttempts.get(key);

  if (!current || now - current.windowStartedAt > loginRateLimitWindowMs) {
    authAttempts.set(key, { count: 1, windowStartedAt: now });
    return { allowed: true, remaining: loginRateLimitMaxAttempts - 1, retryAfterSec: 0 };
  }

  if (current.count >= loginRateLimitMaxAttempts) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.ceil((loginRateLimitWindowMs - (now - current.windowStartedAt)) / 1000),
    };
  }

  current.count += 1;
  authAttempts.set(key, current);
  return { allowed: true, remaining: Math.max(loginRateLimitMaxAttempts - current.count, 0), retryAfterSec: 0 };
}

function clearAuthAttempts(key: string) {
  authAttempts.delete(key);
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

function toSafeUser(user: SelectUser) {
  const { password, ...safeUser } = user;
  return safeUser;
}

export function setupAuth(app: Express) {
  if (!derivedSessionSecret) {
    throw new Error("SESSION_SECRET must be set in production");
  }

  const MemoryStore = createMemoryStore(session);

  const sessionSettings: session.SessionOptions = {
    name: sessionCookieName,
    secret: derivedSessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: isProduction,
    unset: "destroy",
    store: new MemoryStore({
      checkPeriod: 86400000,
      ttl: 30 * 24 * 60 * 60 * 1000,
    }),
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      secure: isProduction,
      httpOnly: true,
      sameSite: "lax",
    },
  };

  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const input = loginSchema.parse({ username, password });
        const user = await storage.getUserByUsername(input.username);
        if (!user || !(await comparePasswords(input.password, user.password))) {
          return done(null, false, { message: "اسم المستخدم أو كلمة المرور غير صحيحة" });
        }
        if (!user.isActive) {
          return done(null, false, { message: "تم إيقاف هذا الحساب" });
        }
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }),
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user);
    } catch (err) {
      done(err);
    }
  });

  app.post("/api/register", async (req, res, next) => {
    try {
      const input = registerSchema.parse(req.body);
      const existing = await storage.getUserByUsername(input.username);
      if (existing) {
        return res.status(400).json({ message: "اسم المستخدم مستخدم بالفعل" });
      }

      const user = await storage.createUser({
        username: input.username,
        password: await hashPassword(input.password),
        name: input.fullName || input.name || input.username,
        email: input.email,
        role: "user",
        isActive: true,
        lastLoginAt: Math.floor(Date.now() / 1000),
        createdAt: Math.floor(Date.now() / 1000),
      });

      await regenerateSession(req);
      await loginUser(req, user);
      await writeAuditEvent({
        action: "user.registered",
        actorUserId: user.id,
        actorRole: user.role,
        targetUserId: user.id,
        ipAddress: req.ip,
      });
      return res.status(201).json(toSafeUser(user));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/login", (req, res, next) => {
    const parsedInput = loginSchema.safeParse(req.body);
    if (!parsedInput.success) {
      return res.status(400).json({ message: "بيانات تسجيل الدخول غير صالحة" });
    }

    req.body = parsedInput.data;
    const attemptKey = getRateLimitKey(parsedInput.data.username, req.ip);
    const rateLimit = consumeAuthAttempt(attemptKey);
    res.setHeader("X-RateLimit-Remaining", rateLimit.remaining.toString());

    if (!rateLimit.allowed) {
      res.setHeader("Retry-After", rateLimit.retryAfterSec.toString());
      void writeAuditEvent({
        action: "auth.login.rate_limited",
        actorRole: null,
        ipAddress: req.ip,
        metadata: { username: parsedInput.data.username },
      });
      return res.status(429).json({ message: "تم تجاوز عدد المحاولات، حاول مرة أخرى لاحقًا" });
    }

    passport.authenticate("local", async (err: any, user: SelectUser | false, info: any) => {
      if (err) return next(err);
      if (!user) {
        void writeAuditEvent({
          action: "auth.login.failed",
          actorRole: null,
          ipAddress: req.ip,
          metadata: { username: parsedInput.data.username, reason: info?.message || "invalid_credentials" },
        });
        return res.status(401).json({ message: info?.message || "فشل تسجيل الدخول" });
      }
      if (!user.isActive) {
        void writeAuditEvent({
          action: "auth.login.blocked_inactive",
          actorUserId: user.id,
          actorRole: user.role,
          targetUserId: user.id,
          ipAddress: req.ip,
        });
        return res.status(401).json({ message: "تم إيقاف هذا الحساب" });
      }
      const updatedUser = await storage.updateUser(user.id, { lastLoginAt: Math.floor(Date.now() / 1000) });
      await regenerateSession(req);
      await loginUser(req, updatedUser);
      clearAuthAttempts(attemptKey);
      await writeAuditEvent({
        action: "auth.login.success",
        actorUserId: updatedUser.id,
        actorRole: updatedUser.role,
        targetUserId: updatedUser.id,
        ipAddress: req.ip,
      });
      return res.json(toSafeUser(updatedUser));
    })(req, res, next);
  });

  app.post("/api/logout", async (req, res, next) => {
    try {
      const actorUserId = req.user?.id ?? null;
      const actorRole = req.user?.role ?? null;
      await logoutUser(req);
      await destroySession(req);
      res.clearCookie(sessionCookieName);
      await writeAuditEvent({
        action: "auth.logout",
        actorUserId,
        actorRole,
        targetUserId: actorUserId,
        ipAddress: req.ip,
      });
      res.json({ message: "تم تسجيل الخروج بنجاح" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "غير مسجل الدخول" });
    }
    res.json(toSafeUser(req.user!));
  });

  app.patch("/api/user", async (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "غير مسجل الدخول" });
    }
    try {
      const data = updateUserSchema.parse(req.body);
      const updated = await storage.updateUser(req.user!.id, data);
      res.json(toSafeUser(updated));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/user/change-password", async (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "غير مسجل الدخول" });
    }
    try {
      const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
      const user = await storage.getUser(req.user!.id);
      if (!user || !(await comparePasswords(currentPassword, user.password))) {
        return res.status(400).json({ message: "كلمة المرور الحالية غير صحيحة" });
      }
      const hashed = await hashPassword(newPassword);
      await storage.updateUser(user.id, { password: hashed });
      await writeAuditEvent({
        action: "user.password_changed",
        actorUserId: user.id,
        actorRole: user.role,
        targetUserId: user.id,
        ipAddress: req.ip,
      });
      res.json({ message: "تم تغيير كلمة المرور بنجاح" });
    } catch (error) {
      next(error);
    }
  });
}
