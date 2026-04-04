import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { writeAuditEvent } from "./audit";
import { canSendMail, sendPasswordResetEmail } from "./mail";
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
const passwordResetRateLimitWindowMs = 10 * 60 * 1000;
const passwordResetRateLimitMaxAttempts = 5;
const passwordResetTokenTtlSec = 10 * 60;
const sessionCookieName = "eltizam.sid";
const authAttempts = new Map<string, { count: number; windowStartedAt: number }>();
const passwordResetAttempts = new Map<string, { count: number; windowStartedAt: number }>();
const passwordStrengthMessage = "كلمة المرور ضعيفة. استخدم 8 أحرف على الأقل مع حرف كبير وحرف صغير ورقم واحد على الأقل";

const passwordSchema = z.string()
  .min(8, passwordStrengthMessage)
  .max(128)
  .regex(/[A-Z]/, passwordStrengthMessage)
  .regex(/[a-z]/, passwordStrengthMessage)
  .regex(/[0-9]/, passwordStrengthMessage);

const emailSchema = z.union([
  z.literal(""),
  z.string().trim().email("البريد الإلكتروني غير صالح"),
]);

const phoneSchema = z.string()
  .trim()
  .regex(/^[0-9+\-\s()]{7,20}$/, "رقم الهاتف غير صالح");

const optionalPhoneSchema = z.union([
  z.literal(""),
  phoneSchema,
]);

const registerSchema = z.object({
  username: z.string().min(3).max(50),
  password: passwordSchema,
  name: z.string().min(1).max(120).optional(),
  fullName: z.string().min(1).max(120).optional(),
  email: emailSchema.optional().default(""),
  phone: optionalPhoneSchema.optional().default(""),
}).refine((data) => {
  const hasEmail = !!data.email?.trim();
  const hasPhone = !!data.phone?.trim();
  return hasEmail || hasPhone;
}, {
  message: "أدخل البريد الإلكتروني أو رقم الهاتف",
  path: ["email"],
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

const forgotPasswordRequestSchema = z.object({
  identifier: z.string().trim().min(1).max(120),
});

const passwordResetStartSchema = z.object({
  identifier: z.string().trim().min(1).max(120),
});

const passwordResetCompleteSchema = z.object({
  token: z.string().trim().min(4).max(32),
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

function saveSession(req: Express.Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.save((err) => {
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

function consumePasswordResetAttempt(key: string) {
  const now = Date.now();
  const current = passwordResetAttempts.get(key);

  if (!current || now - current.windowStartedAt > passwordResetRateLimitWindowMs) {
    passwordResetAttempts.set(key, { count: 1, windowStartedAt: now });
    return { allowed: true, remaining: passwordResetRateLimitMaxAttempts - 1, retryAfterSec: 0 };
  }

  if (current.count >= passwordResetRateLimitMaxAttempts) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.ceil((passwordResetRateLimitWindowMs - (now - current.windowStartedAt)) / 1000),
    };
  }

  current.count += 1;
  passwordResetAttempts.set(key, current);
  return { allowed: true, remaining: Math.max(passwordResetRateLimitMaxAttempts - current.count, 0), retryAfterSec: 0 };
}

function clearPasswordResetAttempts(key: string) {
  passwordResetAttempts.delete(key);
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

function getValidationMessage(error: z.ZodError) {
  return error.issues[0]?.message || "البيانات المدخلة غير صالحة";
}

function normalizePhoneForLookup(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  let normalized = trimmed.replace(/[\s\-()]/g, "");
  if (normalized.startsWith("00")) {
    normalized = `+${normalized.slice(2)}`;
  }

  return normalized;
}

function getPhoneDigits(value: string) {
  return normalizePhoneForLookup(value).replace(/\D/g, "");
}

async function findUserByPhoneIdentifier(identifier: string) {
  const normalizedPhone = normalizePhoneForLookup(identifier);
  if (!normalizedPhone) {
    return undefined;
  }

  const exactPhoneMatch = await storage.getUserByPhone(normalizedPhone);
  if (exactPhoneMatch) {
    return exactPhoneMatch;
  }

  const identifierDigits = getPhoneDigits(identifier);
  if (!identifierDigits) {
    return undefined;
  }

  const matchedUsers = (await storage.getAllUsers()).filter((user) => {
    const userPhone = user.phone?.trim();
    if (!userPhone) {
      return false;
    }

    const normalizedUserPhone = normalizePhoneForLookup(userPhone);
    if (normalizedUserPhone === normalizedPhone) {
      return true;
    }

    const userDigits = getPhoneDigits(userPhone);
    if (!userDigits) {
      return false;
    }

    return userDigits.endsWith(identifierDigits) || identifierDigits.endsWith(userDigits);
  });

  if (matchedUsers.length === 1) {
    return matchedUsers[0];
  }

  return undefined;
}

async function findUserByIdentifier(identifier: string) {
  const normalized = identifier.trim();
  return (await storage.getUserByUsername(normalized))
    || (await storage.getUserByEmail(normalized))
    || (await findUserByPhoneIdentifier(normalized));
}

function maskContactValue(value: string) {
  if (value.includes("@")) {
    const [localPart, domain] = value.split("@");
    const visibleLocal = localPart.slice(0, 2);
    return `${visibleLocal}${"*".repeat(Math.max(localPart.length - visibleLocal.length, 2))}@${domain}`;
  }

  const trimmed = value.trim();
  if (trimmed.length <= 4) {
    return "*".repeat(trimmed.length);
  }

  return `${trimmed.slice(0, 2)}${"*".repeat(Math.max(trimmed.length - 4, 2))}${trimmed.slice(-2)}`;
}

function buildPasswordResetToken() {
  return (Math.floor(100000 + Math.random() * 900000)).toString();
}

export async function hashPlainPassword(password: string) {
  return hashPassword(password);
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
      const parsedInput = registerSchema.safeParse(req.body);
      if (!parsedInput.success) {
        return res.status(400).json({ message: getValidationMessage(parsedInput.error) });
      }
      const input = parsedInput.data;
      const existing = await storage.getUserByUsername(input.username);
      if (existing) {
        return res.status(400).json({ message: "اسم المستخدم مستخدم بالفعل" });
      }
      const normalizedEmail = input.email?.trim() || "";
      const normalizedPhone = input.phone?.trim() || "";
      if (normalizedEmail) {
        const existingEmail = await storage.getUserByEmail(normalizedEmail);
        if (existingEmail) {
          return res.status(400).json({ message: "البريد الإلكتروني مستخدم بالفعل" });
        }
      }
      if (normalizedPhone) {
        const existingPhone = await storage.getUserByPhone(normalizedPhone);
        if (existingPhone) {
          return res.status(400).json({ message: "رقم الهاتف مستخدم بالفعل" });
        }
      }
      const existingUsers = await storage.getAllUsers();
      const assignedRole = existingUsers.length === 0 ? "system_admin" : "user";
      const user = await storage.createUser({
        username: input.username,
        password: await hashPassword(input.password),
        name: input.fullName || input.name || input.username,
        email: normalizedEmail,
        phone: normalizedPhone || null,
        role: assignedRole,
        isActive: true,
        lastLoginAt: Math.floor(Date.now() / 1000),
        createdAt: Math.floor(Date.now() / 1000),
      });
      await regenerateSession(req);
      await loginUser(req, user);
      await saveSession(req);
      await writeAuditEvent({ action: "user.registered", actorUserId: user.id, actorRole: user.role, targetUserId: user.id, ipAddress: req.ip });
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
      void writeAuditEvent({ action: "auth.login.rate_limited", actorRole: null, ipAddress: req.ip, metadata: { username: parsedInput.data.username } });
      return res.status(429).json({ message: "تم تجاوز عدد المحاولات، حاول مرة أخرى لاحقًا" });
    }
    passport.authenticate("local", async (err: any, user: SelectUser | false, info: any) => {
      if (err) return next(err);
      if (!user) {
        void writeAuditEvent({ action: "auth.login.failed", actorRole: null, ipAddress: req.ip, metadata: { username: parsedInput.data.username, reason: info?.message || "invalid_credentials" } });
        return res.status(401).json({ message: info?.message || "فشل تسجيل الدخول" });
      }
      if (!user.isActive) {
        void writeAuditEvent({ action: "auth.login.blocked_inactive", actorUserId: user.id, actorRole: user.role, targetUserId: user.id, ipAddress: req.ip });
        return res.status(401).json({ message: "تم إيقاف هذا الحساب" });
      }
      const updatedUser = await storage.updateUser(user.id, { lastLoginAt: Math.floor(Date.now() / 1000) });
      await regenerateSession(req);
      await loginUser(req, updatedUser);
      await saveSession(req);
      clearAuthAttempts(attemptKey);
      await writeAuditEvent({ action: "auth.login.success", actorUserId: updatedUser.id, actorRole: updatedUser.role, targetUserId: updatedUser.id, ipAddress: req.ip });
      return res.json(toSafeUser(updatedUser));
    })(req, res, next);
  });

  app.post("/api/password-reset/request", async (req, res, next) => {
    try {
      const parsedInput = forgotPasswordRequestSchema.safeParse(req.body);
      if (!parsedInput.success) {
        return res.status(400).json({ message: getValidationMessage(parsedInput.error) });
      }
      const identifier = parsedInput.data.identifier.trim();
      const user = await findUserByIdentifier(identifier);
      if (user && user.isActive) {
        await storage.createPasswordResetRequest({ userId: user.id, status: "pending", verificationMethod: "admin", requestedByIdentifier: identifier, contactValue: user.email || user.phone || null, resetToken: null, resetTokenExpiresAt: null, adminUserId: null, createdAt: Math.floor(Date.now() / 1000), resolvedAt: null });
        await writeAuditEvent({ action: "auth.password_reset.requested", actorRole: null, targetUserId: user.id, ipAddress: req.ip, metadata: { identifier } });
      }
      return res.json({ message: "إذا كانت البيانات صحيحة فسيتم إرسال طلب إعادة التعيين للإدارة" });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/password-reset/request-token", async (req, res, next) => {
    try {
      const parsedInput = passwordResetStartSchema.safeParse(req.body);
      if (!parsedInput.success) {
        return res.status(400).json({ message: getValidationMessage(parsedInput.error) });
      }

      const identifier = parsedInput.data.identifier.trim();
      const attemptKey = getRateLimitKey(identifier, req.ip);
      const rateLimit = consumePasswordResetAttempt(attemptKey);
      res.setHeader("X-RateLimit-Remaining", rateLimit.remaining.toString());
      if (!rateLimit.allowed) {
        res.setHeader("Retry-After", rateLimit.retryAfterSec.toString());
        return res.status(429).json({ message: "تم تجاوز عدد محاولات الاستعادة، حاول مرة أخرى لاحقًا" });
      }

      const user = await findUserByIdentifier(identifier);
      if (!user || !user.isActive) {
        return res.json({
          message: "إذا كانت البيانات صحيحة فسيتم إرسال رمز التحقق إلى وسيلة التواصل المسجلة أو يمكنك المتابعة مع الإدارة",
          deliveryMethod: null,
          maskedContact: null,
          fallbackToAdmin: true,
        });
      }

      const contactValue = (user.email || user.phone || "").trim();
      if (!contactValue) {
        return res.json({
          message: "لا توجد وسيلة تواصل صالحة لهذا الحساب، يمكنك المتابعة مع الإدارة",
          deliveryMethod: null,
          maskedContact: null,
          fallbackToAdmin: true,
        });
      }

      const resetToken = buildPasswordResetToken();
      const resetTokenExpiresAt = Math.floor(Date.now() / 1000) + passwordResetTokenTtlSec;
      const deliveryMethod: "email" | "phone" = user.email ? "email" : "phone";

      if (deliveryMethod !== "email" || !user.email?.trim()) {
        return res.json({
          message: "الاستعادة الذاتية عبر البريد الإلكتروني غير متاحة لهذا الحساب، يمكنك المتابعة مع الإدارة",
          deliveryMethod: null,
          maskedContact: null,
          fallbackToAdmin: true,
        });
      }

      if (!canSendMail()) {
        return res.status(503).json({ message: "خدمة البريد غير مهيأة حالياً. يرجى ضبط إعدادات SMTP ثم إعادة المحاولة" });
      }

      const passwordResetRequest = await storage.createPasswordResetRequest({
        userId: user.id,
        status: "pending",
        verificationMethod: "self_service",
        requestedByIdentifier: identifier,
        contactValue,
        resetToken,
        resetTokenExpiresAt,
        adminUserId: null,
        createdAt: Math.floor(Date.now() / 1000),
        resolvedAt: null,
      });

      try {
        await sendPasswordResetEmail({
          to: user.email.trim(),
          code: resetToken,
          expiresInMinutes: Math.floor(passwordResetTokenTtlSec / 60),
        });
      } catch (mailError) {
        await storage.updatePasswordResetRequest(passwordResetRequest.id, {
          status: "delivery_failed",
          resolvedAt: Math.floor(Date.now() / 1000),
          resetToken: null,
        });
        return res.status(502).json({ message: "تعذر إرسال رمز الاستعادة إلى البريد الإلكتروني. تحقق من إعدادات البريد ثم أعد المحاولة" });
      }

      await writeAuditEvent({
        action: "auth.password_reset.self_service_requested",
        actorRole: null,
        targetUserId: user.id,
        ipAddress: req.ip,
        metadata: { identifier, deliveryMethod },
      });

      return res.json({
        message: "تم إرسال رمز الاستعادة إلى بريدك الإلكتروني المسجل",
        deliveryMethod,
        maskedContact: maskContactValue(contactValue),
        fallbackToAdmin: true,
        debugCode: isProduction ? undefined : resetToken,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/password-reset/complete", async (req, res, next) => {
    try {
      const parsedInput = passwordResetCompleteSchema.safeParse(req.body);
      if (!parsedInput.success) {
        return res.status(400).json({ message: getValidationMessage(parsedInput.error) });
      }

      const token = parsedInput.data.token.trim();
      const resetRequest = await storage.getPasswordResetRequestByToken(token);
      if (!resetRequest || resetRequest.verificationMethod !== "self_service" || resetRequest.status !== "pending") {
        return res.status(400).json({ message: "رمز الاستعادة غير صالح" });
      }

      const now = Math.floor(Date.now() / 1000);
      if (!resetRequest.resetTokenExpiresAt || resetRequest.resetTokenExpiresAt < now) {
        await storage.updatePasswordResetRequest(resetRequest.id, {
          status: "expired",
          resolvedAt: now,
          resetToken: null,
        });
        return res.status(400).json({ message: "انتهت صلاحية رمز الاستعادة" });
      }

      const user = await storage.getUser(resetRequest.userId);
      if (!user || !user.isActive) {
        return res.status(400).json({ message: "تعذر إكمال استعادة كلمة المرور" });
      }

      const hashed = await hashPassword(parsedInput.data.newPassword);
      await storage.updateUser(user.id, { password: hashed });
      await storage.updatePasswordResetRequest(resetRequest.id, {
        status: "approved",
        resolvedAt: now,
        resetToken: null,
      });
      clearPasswordResetAttempts(getRateLimitKey(resetRequest.requestedByIdentifier, req.ip));
      await writeAuditEvent({
        action: "auth.password_reset.self_service_completed",
        actorRole: null,
        targetUserId: user.id,
        ipAddress: req.ip,
        metadata: { requestId: resetRequest.id },
      });
      return res.json({ message: "تمت إعادة تعيين كلمة المرور بنجاح" });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/logout", async (req, res, next) => {
    try {
      const actorUserId = req.user?.id ?? null;
      const actorRole = req.user?.role ?? null;
      await logoutUser(req);
      await destroySession(req);
      res.clearCookie(sessionCookieName);
      await writeAuditEvent({ action: "auth.logout", actorUserId, actorRole, targetUserId: actorUserId, ipAddress: req.ip });
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
      const parsedInput = changePasswordSchema.safeParse(req.body);
      if (!parsedInput.success) {
        return res.status(400).json({ message: getValidationMessage(parsedInput.error) });
      }
      const { currentPassword, newPassword } = parsedInput.data;
      const user = await storage.getUser(req.user!.id);
      if (!user || !(await comparePasswords(currentPassword, user.password))) {
        return res.status(400).json({ message: "كلمة المرور الحالية غير صحيحة" });
      }
      const hashed = await hashPassword(newPassword);
      await storage.updateUser(user.id, { password: hashed });
      await writeAuditEvent({ action: "user.password_changed", actorUserId: user.id, actorRole: user.role, targetUserId: user.id, ipAddress: req.ip });
      res.json({ message: "تم تغيير كلمة المرور بنجاح" });
    } catch (error) {
      next(error);
    }
  });
}
