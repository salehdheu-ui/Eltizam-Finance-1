import { z } from "zod";

/**
 * Input rules shared by the browser and the server.
 *
 * The client imports these so a bad value is caught before a request is made,
 * and the server imports the same objects so that skipping the client (curl,
 * a replayed request, a stale bundle) cannot get past a weaker check. Changing
 * a limit here changes it on both sides at once, which is the point: two copies
 * of a rule drift apart and the weaker copy becomes the real one.
 */

export const TEXT_LIMITS = {
  shortName: 100,
  title: 200,
  note: 1000,
  description: 2000,
  username: 64,
  email: 254,
  phone: 32,
  color: 80,
  icon: 64,
  url: 2048,
} as const;

/** Largest money amount accepted anywhere; keeps absurd values out of the ledger. */
export const MAX_MONEY_AMOUNT = 1_000_000_000_000;

// C0/C1 control characters plus the zero-width and bidi-override ranges. These
// are invisible in a UI but change how text is read, logged, or exported, so
// they are stripped rather than rejected — someone pasting from Word or a PDF
// should not get an error. Tab, newline, and carriage return are deliberately
// left in so the multi-line variant below can keep real line breaks.
const CONTROL_AND_INVISIBLE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * Normalizes free text before it is stored: strips invisible characters,
 * collapses runs of whitespace, trims, and caps the length.
 *
 * This is a normalizer, not an HTML escaper. Output encoding is what actually
 * stops XSS, and React already escapes every value it renders; escaping here
 * too would double-encode and show users "&amp;" in their own wallet names.
 */
export function sanitizeText(value: unknown, maxLength: number = TEXT_LIMITS.note): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(CONTROL_AND_INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/** Same normalization but keeps line breaks, for multi-line notes. */
export function sanitizeMultilineText(
  value: unknown,
  maxLength: number = TEXT_LIMITS.description,
): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(CONTROL_AND_INVISIBLE, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

/** Required single-line text: sanitized first, then required to be non-empty. */
export function safeText(maxLength: number = TEXT_LIMITS.shortName, message = "هذا الحقل مطلوب") {
  return z.preprocess(
    (value) => sanitizeText(value, maxLength),
    z.string().min(1, message).max(maxLength, `الحد الأقصى ${maxLength} حرفًا`),
  );
}

/** Optional single-line text; blank and whitespace-only collapse to undefined. */
export function optionalSafeText(maxLength: number = TEXT_LIMITS.shortName) {
  return z.preprocess((value) => {
    if (value === null || value === undefined) return undefined;
    const cleaned = sanitizeText(value, maxLength);
    return cleaned === "" ? undefined : cleaned;
  }, z.string().max(maxLength, `الحد الأقصى ${maxLength} حرفًا`).optional());
}

/** Optional multi-line text, for notes and descriptions. */
export function optionalSafeMultiline(maxLength: number = TEXT_LIMITS.description) {
  return z.preprocess((value) => {
    if (value === null || value === undefined) return undefined;
    const cleaned = sanitizeMultilineText(value, maxLength);
    return cleaned === "" ? undefined : cleaned;
  }, z.string().max(maxLength, `الحد الأقصى ${maxLength} حرفًا`).optional());
}

/**
 * Turns a numeric-looking input into a real number, or reports failure.
 *
 * Number("") is 0 and Number([]) is 0, so blank and array inputs are rejected
 * before conversion instead of silently becoming a zero amount.
 */
export function coerceFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

/** A number that may arrive as a string from a form or a query parameter. */
export function numericSchema(options: { min?: number; max?: number; message?: string } = {}) {
  const { min, max, message = "قيمة رقمية غير صالحة" } = options;
  let schema = z.number({ invalid_type_error: message }).finite(message);
  if (min !== undefined) schema = schema.min(min, `القيمة يجب ألا تقل عن ${min}`);
  if (max !== undefined) schema = schema.max(max, `القيمة يجب ألا تزيد عن ${max}`);

  // Falls through with the original value when coercion fails so that zod
  // reports the type error instead of this returning a silent undefined.
  return z.preprocess((value) => coerceFiniteNumber(value) ?? value, schema);
}

/** A positive database identifier. */
export const idSchema = numericSchema({ min: 1, message: "معرّف غير صالح" }).pipe(
  z.number().int("معرّف غير صالح"),
);

/** A money amount: finite, non-negative, and capped. */
export const moneySchema = numericSchema({
  min: 0,
  max: MAX_MONEY_AMOUNT,
  message: "المبلغ غير صالح",
});

/**
 * A money amount that may be negative.
 *
 * Wallet balances go below zero through ordinary use — a transfer or an
 * overspend subtracts without a floor — so reconciling an overdrawn wallet by
 * hand has to stay possible. Only the magnitude is capped.
 */
export const signedMoneySchema = numericSchema({
  min: -MAX_MONEY_AMOUNT,
  max: MAX_MONEY_AMOUNT,
  message: "المبلغ غير صالح",
});

/** Day of the month, for recurring entries. */
export const dayOfMonthSchema = numericSchema({ min: 1, max: 31, message: "يوم غير صالح" }).pipe(
  z.number().int("يوم غير صالح"),
);

/**
 * Day of the month for a *recurring* entry, capped at 28.
 *
 * A salary set to the 30th would silently skip February, so recurring
 * schedules only accept a day that exists in every month.
 */
export const recurringDayOfMonthSchema = numericSchema({ min: 1, max: 28, message: "يوم غير صالح" }).pipe(
  z.number().int("يوم غير صالح"),
);

/** Month of the year, for yearly recurring entries. */
export const monthOfYearSchema = numericSchema({ min: 1, max: 12, message: "شهر غير صالح" }).pipe(
  z.number().int("شهر غير صالح"),
);

/**
 * A color as this UI stores it. That is either a hex code or a set of Tailwind
 * utility tokens ("bg-orange-100 text-orange-600", "from-slate-600 to-slate-800"),
 * so spaces and slashes are allowed — but quotes, braces, and semicolons are not,
 * since these strings are interpolated into className and style attributes.
 */
export const colorSchema = z.preprocess(
  (value) => sanitizeText(value, TEXT_LIMITS.color),
  z
    .string()
    .min(1, "لون غير صالح")
    .max(TEXT_LIMITS.color)
    .regex(/^(#[0-9a-fA-F]{3,8}|[a-zA-Z0-9][a-zA-Z0-9 _\/.\[\]#-]*)$/, "لون غير صالح"),
);

export const emailSchema = z.preprocess(
  (value) => sanitizeText(value, TEXT_LIMITS.email).toLowerCase(),
  z.string().email("بريد إلكتروني غير صالح").max(TEXT_LIMITS.email),
);

export const phoneSchema = z.preprocess(
  (value) => sanitizeText(value, TEXT_LIMITS.phone).replace(/[\s()-]/g, ""),
  z.string().regex(/^\+?[0-9]{7,15}$/, "رقم هاتف غير صالح"),
);

/**
 * Only http(s) URLs. Blocks javascript:, data:, and file:, which are the
 * schemes that turn a stored link into script execution or local file access.
 */
export const httpUrlSchema = z.preprocess(
  (value) => sanitizeText(value, TEXT_LIMITS.url),
  z
    .string()
    .max(TEXT_LIMITS.url)
    .refine((value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    }, "رابط غير صالح"),
);

/** Reads the first error message out of a failed parse, for showing next to a field. */
export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message || "البيانات المدخلة غير صالحة";
}

/**
 * Validates on the client without throwing, so a form can show a message
 * instead of crashing a render.
 */
export function validateInput<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
): { ok: true; data: z.infer<T> } | { ok: false; message: string } {
  const result = schema.safeParse(value);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, message: firstIssueMessage(result.error) };
}
