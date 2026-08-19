import { coerceFiniteNumber, idSchema } from "@shared/validation";

/**
 * Request-shaped input helpers.
 *
 * These live apart from shared/validation.ts because they throw HTTP-shaped
 * errors, which is a server concern; the rules they enforce come from the
 * shared module so the browser checks the same things.
 */

/** A 400 the shared error handler in server/index.ts already knows how to render. */
export function badRequest(message: string) {
  return Object.assign(new Error(message), { status: 400 });
}

/**
 * Reads a positive integer id out of a route parameter.
 *
 * Callers used to take whatever parseInt or Number produced, so "/api/wallets/abc"
 * carried NaN all the way into a query and surfaced as a 500. Anything that is
 * not a positive integer is rejected here as a 400.
 */
export function parseRouteId(param: string | string[]) {
  const parsed = tryParseRouteId(param);

  if (parsed === null) {
    throw badRequest("معرّف غير صالح");
  }

  return parsed;
}

/**
 * Same parse, but reports failure instead of throwing, for routes that answer a
 * bad id with their own status code rather than a 400.
 */
export function tryParseRouteId(param: string | string[]) {
  const raw = Array.isArray(param) ? param[0] : param;
  const parsed = idSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Coerces an optional numeric field, keeping the undefined/null distinction the
 * update routes rely on: undefined means "leave unchanged", null means "clear".
 */
export function toOptionalNumber(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  const parsed = coerceFiniteNumber(value);
  if (parsed === undefined) {
    throw badRequest("قيمة رقمية غير صالحة");
  }

  return parsed;
}

/**
 * Coerces a required numeric field.
 *
 * Number([]) is 0 and Number({}) is NaN, so a posted array or object used to
 * slip through as a real amount or a NaN; both are rejected now.
 */
export function toRequiredNumber(value: unknown) {
  const parsed = coerceFiniteNumber(value);
  if (parsed === undefined) {
    throw badRequest("قيمة رقمية غير صالحة");
  }

  return parsed;
}
