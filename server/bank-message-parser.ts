import { createHash } from "crypto";

export type BankKey = "bank_muscat" | "nbo" | "bank_dhofar" | "sohar_international" | "ahlibank" | "oman_arab_bank" | "bank_nizwa" | "other";

export type TransactionDirection = "debit" | "credit";
export type TransactionChannel = "pos" | "atm" | "transfer" | "bill" | "salary" | "online" | "fee" | "other";

export type ParsedBankMessage = {
  bankKey: BankKey;
  direction: TransactionDirection;
  transactionType: "income" | "expense";
  operation: "deposit" | "purchase" | "withdrawal" | "transfer" | "payment";
  channel: TransactionChannel;
  amount: number;
  balanceAfter: number | null;
  merchant: string;
  counterparty: string | null;
  fromAccount: string | null;
  toAccount: string | null;
  accountRef: string | null;
  reference: string | null;
  categoryHint: string | null;
  confidence: number;
};

export const BANK_PROFILES: Array<{ key: BankKey; name: string; senders: string[] }> = [
  { key: "bank_muscat", name: "بنك مسقط", senders: ["bankmuscat", "bank muscat"] },
  { key: "nbo", name: "البنك الوطني العماني", senders: ["nbo.co.om", "national bank of oman", "nbo"] },
  { key: "bank_dhofar", name: "بنك ظفار", senders: ["bankdhofar", "bank dhofar"] },
  { key: "sohar_international", name: "صحار الدولي", senders: ["soharinternational", "sohar international"] },
  { key: "ahlibank", name: "الأهلي بنك", senders: ["ahlibank", "ahli bank"] },
  { key: "oman_arab_bank", name: "بنك عمان العربي", senders: ["oman arab bank", "oab"] },
  { key: "bank_nizwa", name: "بنك نزوى", senders: ["banknizwa", "bank nizwa"] },
  { key: "other", name: "بنك آخر", senders: [] },
];

function normalizeDigits(value: string) {
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  return value
    .replace(/[٠-٩]/g, (digit) => String(arabic.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persian.indexOf(digit)))
    .replace(/٫/g, ".")
    .replace(/٬/g, ",")
    .replace(/ /g, " ");
}

const CURRENCY = String.raw`(?:OMR|R\.?O\.?|ر\.?\s?ع\.?|ريال(?:اً)?(?:\s+عمان(?:ي|ياً)?)?)`;
const MONEY = String.raw`([0-9][0-9,]*(?:\.[0-9]{1,3})?)`;

type Span = { start: number; end: number };

function overlaps(index: number, spans: Span[]) {
  return spans.some((span) => index >= span.start && index < span.end);
}

/**
 * The closing balance a bank prints alongside the transaction. Captured before the
 * amount so the amount extractor can exclude it — otherwise a message that prints
 * "balance 500 ... amount 20" imports 500 as the transaction.
 */
function extractBalance(text: string): { value: number | null; spans: Span[] } {
  const patterns = [
    new RegExp(String.raw`(?:available|current|closing|remaining|avail\.?)\s*(?:bal(?:ance)?\.?)\s*(?:is)?\s*[:\-]?\s*${CURRENCY}?\s*${MONEY}`, "gi"),
    new RegExp(String.raw`\bbal(?:ance)?\.?\s*[:\-]?\s*${CURRENCY}?\s*${MONEY}`, "gi"),
    new RegExp(String.raw`(?:الرصيد|رصيدك|رصيد\s*الحساب)\s*(?:المتاح|الحالي|المتوفر|بعد\s*العملية)?\s*[:\-]?\s*${CURRENCY}?\s*${MONEY}`, "g"),
    new RegExp(String.raw`${MONEY}\s*${CURRENCY}?\s*(?:هو\s*)?(?:الرصيد|رصيدك)`, "g"),
  ];

  const spans: Span[] = [];
  let value: number | null = null;

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      spans.push({ start: match.index, end: match.index + match[0].length });
      if (value === null) {
        const parsed = Number(match[1].replace(/,/g, ""));
        if (Number.isFinite(parsed) && parsed >= 0) value = parsed;
      }
    }
  }

  return { value, spans };
}

function extractAmount(text: string, excluded: Span[]): { value: number; index: number } | null {
  const patterns = [
    new RegExp(String.raw`(?:amount|amt|المبلغ|بمبلغ|بقيمة|قيمة)\s*(?:of)?\s*[:\-]?\s*${CURRENCY}?\s*${MONEY}`, "gi"),
    new RegExp(String.raw`${CURRENCY}\s*[:\-]?\s*${MONEY}`, "gi"),
    new RegExp(String.raw`${MONEY}\s*${CURRENCY}`, "gi"),
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (overlaps(match.index, excluded)) continue;
      const parsed = Number(match[1].replace(/,/g, ""));
      if (Number.isFinite(parsed) && parsed > 0) {
        return { value: parsed, index: match.index };
      }
    }
  }
  return null;
}

const DEBIT_TERMS: RegExp[] = [
  /debited?/i, /debit\s+advice/i, /withdraw(?:n|al)?/i, /purchase/i, /\bpos\b/i, /spent/i,
  /paid\s+to/i, /payment\s+of/i, /deducted?/i, /charged?/i, /transfer(?:red)?\s+to/i,
  /خصم/, /خُصم/, /تم\s*الخصم/, /مسحوب/, /سحب/, /شراء/, /مشتريات/, /دفع/, /سداد/, /حوالة\s*صادرة/, /تحويل\s*إلى/,
];

const CREDIT_TERMS: RegExp[] = [
  /credited?/i, /credit\s+advice/i, /deposit(?:ed)?/i, /salary/i, /received/i, /incoming/i,
  /refund(?:ed)?/i, /transfer(?:red)?\s+from/i, /added\s+to/i,
  /إيداع/, /أودع/, /تم\s*الإيضافة/, /تمت\s*الإضافة/, /أضيف/, /إضافة/, /راتب/, /حوالة\s*واردة/, /تحويل\s*من/, /مستلمة/, /استرداد/,
];

/**
 * Direction is decided by whichever signal sits closest to the amount, not by
 * scanning the whole message. Bank emails routinely carry the opposite word in a
 * footer ("to deposit funds visit…"), which is what made deductions register as
 * additions when the whole body was tested at once.
 */
function detectDirection(text: string, amountIndex: number): { direction: TransactionDirection; confident: boolean } {
  const nearest = (terms: RegExp[]) => {
    let best = Number.POSITIVE_INFINITY;
    for (const term of terms) {
      const source = term.source;
      const flags = term.flags.includes("g") ? term.flags : `${term.flags}g`;
      const pattern = new RegExp(source, flags);
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        best = Math.min(best, Math.abs(match.index - amountIndex));
        if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
      }
    }
    return best;
  };

  const debitDistance = nearest(DEBIT_TERMS);
  const creditDistance = nearest(CREDIT_TERMS);

  if (debitDistance === Number.POSITIVE_INFINITY && creditDistance === Number.POSITIVE_INFINITY) {
    return { direction: "debit", confident: false };
  }
  if (debitDistance === creditDistance) {
    return { direction: "debit", confident: false };
  }

  const direction: TransactionDirection = debitDistance < creditDistance ? "debit" : "credit";
  const margin = Math.abs(debitDistance - creditDistance);
  return { direction, confident: margin > 20 };
}

function detectChannel(text: string, direction: TransactionDirection): TransactionChannel {
  if (/\batm\b|cash\s*withdraw|صراف|سحب\s*نقدي/i.test(text)) return "atm";
  if (/salary|payroll|راتب/i.test(text)) return "salary";
  if (/bill\s*payment|utility|فاتورة|فواتير|سداد/i.test(text)) return "bill";
  if (/\bpos\b|point\s*of\s*sale|purchase|card\s*transaction|شراء|نقطة\s*بيع|بطاقة/i.test(text)) return "pos";
  if (/transfer|remittance|حوالة|تحويل/i.test(text)) return "transfer";
  // "debited from A/C … to <party>" names both ends, which is a transfer even
  // when the bank never uses the word.
  if (/\bfrom\s+(?:your\s+)?(?:a\/c|acc(?:ount)?)\b[^\n]*?\bto\b/i.test(text)) return "transfer";
  if (/online|e-?commerce|internet|إنترنت|أونلاين/i.test(text)) return "online";
  if (/fee|charge|commission|رسوم|عمولة/i.test(text)) return "fee";
  return direction === "credit" ? "transfer" : "other";
}

function cleanEntity(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/[.،,;:]+$/, "")
    .replace(/\s+(?:for|amount|amt|on|dated|ref|بقيمة|بمبلغ|بتاريخ|رقم)\b.*$/i, "")
    .trim();
}

// Banks mask account digits with any of these; Bank Nizwa uses '#'.
const ACCOUNT_CHARS = String.raw`[Xx*•#\d]`;
const ACCOUNT_BODY = String.raw`[Xx*•#\d\- ]`;

/**
 * Reduces an account as printed to a comparable shape while keeping the digits
 * the bank chose to reveal. Bank Nizwa shows "01610######001" — first five and
 * last three — so collapsing to "the last four digits" would throw away the part
 * that identifies the account and keep digits that are not even visible.
 */
export function normalizeAccountToken(raw: string) {
  return raw.trim().toUpperCase().replace(/[\s\-]/g, "").replace(/[#X*•]+/g, "*");
}

function displayAccount(value: string) {
  return normalizeAccountToken(value).replace(/\*/g, "••••");
}

function extractAccounts(text: string) {
  const fromPatterns = [
    new RegExp(String.raw`(?:from|debited\s+from)\s+(?:your\s+)?(?:a\/c|acc(?:ount)?|card)\s*(?:no\.?|number)?\s*[:\-]?\s*(${ACCOUNT_CHARS}${ACCOUNT_BODY}{3,24})`, "i"),
    new RegExp(String.raw`من\s*(?:حسابك|الحساب|بطاقتك|البطاقة)\s*(?:رقم)?\s*[:\-]?\s*(${ACCOUNT_CHARS}${ACCOUNT_BODY}{3,24})`, ""),
  ];
  const toPatterns = [
    new RegExp(String.raw`(?:to|credited\s+to)\s+(?:a\/c|acc(?:ount)?|card)\s*(?:no\.?|number)?\s*[:\-]?\s*(${ACCOUNT_CHARS}${ACCOUNT_BODY}{3,24})`, "i"),
    new RegExp(String.raw`إلى\s*(?:حساب|الحساب|بطاقة|البطاقة)\s*(?:رقم)?\s*[:\-]?\s*(${ACCOUNT_CHARS}${ACCOUNT_BODY}{3,24})`, ""),
  ];

  const first = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return displayAccount(match[1]);
    }
    return null;
  };

  return { fromAccount: first(fromPatterns), toAccount: first(toPatterns) };
}

/**
 * Every account or card the message names, in the shape the bank printed it.
 * Keeping the shape matters: banks reveal different parts of the number, so a
 * fixed "last four digits" rule silently loses the identifying part for any
 * bank that masks the tail.
 */
export function extractAccountReferences(text: string) {
  const patterns = [
    new RegExp(String.raw`(?:a\/c|acc(?:ount)?|card)\s*(?:no\.?|number|ending(?:\s+(?:with|in))?)?\s*[:\-]?\s*(${ACCOUNT_CHARS}${ACCOUNT_BODY}{2,24})`, "gi"),
    new RegExp(String.raw`(?:حساب(?:ك|كم)?|الحساب|بطاقت(?:ك|كم)?|البطاقة)\s*(?:رقم|المنتهية\s*(?:بـ|ب)?)?\s*[:\-]?\s*(${ACCOUNT_CHARS}${ACCOUNT_BODY}{2,24})`, "g"),
  ];

  const references = new Set<string>();
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const token = normalizeAccountToken(match[1]);
      if (token.replace(/\D/g, "").length >= 3) references.add(token);
    }
  }
  return Array.from(references);
}

export function normalizeAccountFilter(value: string | null | undefined) {
  const trimmed = (value || "").trim();
  if (!trimmed) return null;
  const token = normalizeAccountToken(trimmed);
  return token.replace(/\D/g, "").length >= 3 ? token : null;
}

/**
 * An exact token is what the user gets by picking a detected account. A filter
 * typed as bare digits is treated as the visible tail of the number, which is
 * how someone reads their own account off a message.
 */
export function accountRefMatches(reference: string, filter: string) {
  const normalizedReference = normalizeAccountToken(reference);
  const normalizedFilter = normalizeAccountToken(filter);
  if (normalizedReference === normalizedFilter) return true;

  if (/^\d+$/.test(normalizedFilter)) {
    return normalizedReference.replace(/\D/g, "").endsWith(normalizedFilter);
  }
  return false;
}

/**
 * With several accounts at one bank every alert arrives from the same sender,
 * so without this the balances of different accounts interleave and the
 * reconciliation compares one account's closing balance against another's.
 * A message naming no account is skipped rather than guessed at.
 */
export function messageMatchesAccount(text: string, accountFilter: string | null | undefined) {
  const filter = normalizeAccountFilter(accountFilter);
  if (!filter) return true;
  return extractAccountReferences(text).some((reference) => accountRefMatches(reference, filter));
}

/**
 * Wording that belongs to the email around the alert rather than to the payee.
 * Without this the mail client's own boilerplate gets filed as a merchant, and
 * every transaction from that "merchant" lands in one meaningless bucket.
 */
const BOILERPLATE = /attach|unsubscrib|disclaim|confidential|copyright|all rights|do not reply|no-?reply|click here|https?:|www\.|@|customer\s+(?:care|service)|helpline|call\s+us|terms|privacy|this\s+(?:message|email|is)|please|thank|dear|بريد|الرسالة|خدمة\s*العملاء|اضغط|الشروط|الخصوصية|شكرا|عزيزي/i;

function isPlausibleCounterparty(value: string) {
  if (value.length < 2 || value.length > 60) return false;
  if (BOILERPLATE.test(value)) return false;
  // A bare amount ("OMR 382") is the transaction, not who it went to.
  if (/^(?:OMR|R\.?O\.?|ر\.?\s?ع\.?|ريال)?[\s:.\-]*[\d,.]+$/i.test(value)) return false;
  // "A/C 01610######001" is the account the money left, not the payee. Filing it
  // as one would key saved decisions on the account instead of who was paid.
  if (/^(?:a\/c|acc(?:ount)?|card|حساب|الحساب|بطاقة|البطاقة)\b/i.test(value)) return false;
  // Needs at least one letter; pure punctuation or digits identify nobody.
  return /[A-Za-z؀-ۿ]/.test(value);
}

function extractCounterparty(text: string) {
  const patterns = [
    // \b matters: without it "at" matches inside "attachments" and captures the
    // mail footer as the payee.
    /\b(?:at|merchant)\b\s*[:\-]?\s*([^,.;\n]{2,60})/i,
    // A payee name the bank partly masked, e.g. "to MAHM#######LFAN".
    /\b(?:paid\s+to|transferred\s+to|to)\s+([A-Z0-9#*•]{4,40})(?![^\s,.;])/,
    /\b(?:paid\s+to|transferred\s+to|to)\s+([A-Z][^,.;\n]{2,60})/,
    /\b(?:received\s+from|transferred\s+from|from)\s+([A-Z][^,.;\n]{2,60})/,
    /(?<!\S)(?:لدى|المتجر|التاجر)\s*[:\-]?\s*([^،,.؛\n]{2,60})/,
    /(?<!\S)(?:إلى|من)\s+(?!حساب|الحساب|بطاقة|البطاقة)([^،,.؛\n]{2,60})/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const cleaned = cleanEntity(match[1]);
    if (isPlausibleCounterparty(cleaned)) return cleaned;
  }
  return null;
}

function extractReference(text: string) {
  const match = text.match(/(?:ref(?:erence)?|txn|transaction)\s*(?:no\.?|id|#)?\s*[:\-]?\s*([A-Za-z0-9\-]{4,30})/i)
    || text.match(/(?:المرجع|رقم\s*العملية|رقم\s*المرجع)\s*[:\-]?\s*([A-Za-z0-9\-]{4,30})/);
  return match?.[1] ?? null;
}

/**
 * Keywords need real boundaries: unanchored, "lab" matches inside "Available",
 * "rent" inside "current" and "lease" inside "please", so a plain balance line
 * would file itself under health, rent and housing at once.
 */
function categoryPattern(...words: string[]) {
  const parts = words.map((word) => (
    /^[\x20-\x7E]+$/.test(word)
      ? String.raw`\b${word}\b`
      : String.raw`(?<!\p{L})${word}(?!\p{L})`
  ));
  return new RegExp(parts.join("|"), "iu");
}

/** Matched against the payee first, so a word in the bank's prose cannot outvote it. */
const CATEGORY_RULES: Array<[string, RegExp]> = [
  ["مطاعم", categoryPattern("restaurant", "cafe", "coffee", "kfc", "mcdonald", "pizza", "burger", "bakery", "juice", "starbucks", "subway", "talabat", "akeed", "مطعم", "مقهى", "كافيه", "قهوة", "مخبز", "عصير", "بيتزا", "برجر")],
  ["وقود", categoryPattern("fuel", "petrol", "shell", "oman\\s*oil", "al\\s*maha", "naft", "ola\\s*energy", "نفط", "وقود", "محطة", "المها")],
  ["اتصالات", categoryPattern("omantel", "ooredoo", "vodafone", "renna", "friendi", "telecom", "recharge", "عمانتل", "اوريدو", "فودافون", "اتصالات")],
  ["بقالة", categoryPattern("grocery", "supermarket", "hypermarket", "lulu", "carrefour", "nesto", "sultan\\s*center", "al\\s*meera", "safeer", "khimji", "بقالة", "سوبرماركت", "هايبر", "لولو", "كارفور", "نستو")],
  ["صحة", categoryPattern("hospital", "clinic", "pharmacy", "medical", "dental", "badr\\s*al\\s*samaa", "صيدلية", "مستشفى", "عيادة", "أسنان", "مختبر")],
  ["فواتير", categoryPattern("electricity", "mazoon", "majan", "nama", "utility", "كهرباء", "مياه", "فاتورة", "فواتير", "مزون", "نماء")],
  ["مواصلات", categoryPattern("taxi", "uber", "careem", "otaxi", "parking", "mwasalat", "airline", "oman\\s*air", "salam\\s*air", "flight", "تاكسي", "كريم", "مواصلات", "مواقف", "طيران")],
  ["تعليم", categoryPattern("school", "university", "college", "tuition", "مدرسة", "جامعة", "كلية", "تعليم")],
  ["تسوق", categoryPattern("mall", "store", "shop", "amazon", "shein", "namshi", "centrepoint", "متجر", "تسوق", "مول", "أمازون")],
  ["ترفيه", categoryPattern("cinema", "netflix", "spotify", "shahid", "osn", "playstation", "entertainment", "سينما", "نتفلكس", "شاهد", "ترفيه", "ألعاب")],
  ["تأمين", categoryPattern("insurance", "takaful", "تأمين", "تكافل")],
  ["إيجار", categoryPattern("rent", "rental", "lease", "إيجار", "ايجار")],
  ["راتب", categoryPattern("salary", "payroll", "wages", "راتب", "رواتب", "أجور")],
];

/**
 * Falls back to what the operation itself was when no payee keyword matches.
 * An ATM withdrawal or a bank fee is a meaningful category on its own, and
 * leaving it uncategorised is what makes every row read as "أخرى".
 */
const CATEGORY_BY_CHANNEL: Partial<Record<TransactionChannel, string>> = {
  atm: "سحب نقدي",
  transfer: "تحويلات",
  bill: "فواتير",
  salary: "راتب",
  fee: "رسوم بنكية",
  online: "تسوق",
};

function inferCategory(text: string, counterparty: string | null, channel: TransactionChannel) {
  const byCounterparty = counterparty
    ? CATEGORY_RULES.find(([, rule]) => rule.test(counterparty))?.[0]
    : undefined;
  if (byCounterparty) return byCounterparty;

  const byText = CATEGORY_RULES.find(([, rule]) => rule.test(text))?.[0];
  if (byText) return byText;

  return CATEGORY_BY_CHANNEL[channel] ?? null;
}

export function normalizeSenderList(value: string | null | undefined) {
  if (!value) return [];
  return Array.from(new Set(
    value
      .split(/[,;\n]/)
      .map((entry) => entry.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean),
  ));
}

/**
 * Every sender we are allowed to read for a connection: the bank's known senders
 * plus whatever the user registered themselves. An empty result means we have no
 * filter, and scanning the whole mailbox is never an acceptable fallback.
 */
export function resolveAllowedSenders(bankKey: BankKey, customSenders?: string | string[] | null) {
  const profile = BANK_PROFILES.find((bank) => bank.key === bankKey);
  const custom = Array.isArray(customSenders)
    ? normalizeSenderList(customSenders.join(","))
    : normalizeSenderList(customSenders);
  return Array.from(new Set([...(profile?.senders || []), ...custom]));
}

/**
 * A first sync reaches back far enough to build a history; later ones ask only
 * for what arrived since the last successful read, minus an overlap. The overlap
 * covers mail that reaches the mailbox out of order, and re-reading a message we
 * already hold costs nothing because it is recognised by its provider id.
 */
export const INITIAL_SYNC_DAYS = 90;
export const SYNC_OVERLAP_SECONDS = 2 * 86400;

export function resolveSyncWindowStart(lastSyncAt: number | null | undefined, now = Math.floor(Date.now() / 1000)) {
  const initial = now - INITIAL_SYNC_DAYS * 86400;
  if (!lastSyncAt) return initial;
  return Math.max(initial, lastSyncAt - SYNC_OVERLAP_SECONDS);
}

export function buildBankSearchQuery(bankKey: BankKey, customSenders?: string | string[] | null, since?: number | null) {
  const senders = resolveAllowedSenders(bankKey, customSenders);
  if (senders.length === 0) return null;
  const senderQuery = senders.map((sender) => `from:(${sender})`).join(" OR ");
  const window = typeof since === "number" ? `after:${Math.max(0, Math.floor(since))}` : `newer_than:${INITIAL_SYNC_DAYS}d`;
  return `${window} (${senderQuery})`;
}

export function senderMatchesBank(bankKey: BankKey, sender: string, customSenders?: string | string[] | null) {
  const senders = resolveAllowedSenders(bankKey, customSenders);
  if (senders.length === 0) return false;
  const normalized = sender.toLowerCase();
  return senders.some((value) => normalized.includes(value));
}

const OPERATION_BY_CHANNEL: Record<TransactionChannel, ParsedBankMessage["operation"]> = {
  atm: "withdrawal",
  salary: "deposit",
  bill: "payment",
  pos: "purchase",
  transfer: "transfer",
  online: "purchase",
  fee: "payment",
  other: "purchase",
};

export function parseBankMessage(input: { bankKey: BankKey; sender: string; subject: string; body: string }): ParsedBankMessage | null {
  const combined = normalizeDigits(`${input.subject}\n${input.body}`);
  const balance = extractBalance(combined);
  const amount = extractAmount(combined, balance.spans);
  if (!amount) return null;

  const { direction, confident } = detectDirection(combined, amount.index);
  const channel = detectChannel(combined, direction);
  const accounts = extractAccounts(combined);
  const counterparty = extractCounterparty(combined);

  // A credit lands in the account, so the account is the destination; a debit
  // leaves it. Whichever side the message did not spell out is the counterparty.
  const fromAccount = accounts.fromAccount || (direction === "credit" ? counterparty : null);
  const toAccount = accounts.toAccount || (direction === "debit" ? counterparty : null);

  const operation = direction === "credit" && channel !== "transfer"
    ? "deposit"
    : OPERATION_BY_CHANNEL[channel];

  return {
    bankKey: input.bankKey,
    direction,
    transactionType: direction === "credit" ? "income" : "expense",
    operation,
    channel,
    amount: amount.value,
    balanceAfter: balance.value,
    merchant: counterparty || "معاملة بنكية",
    counterparty,
    fromAccount,
    toAccount,
    accountRef: extractAccountReferences(combined)[0] ?? null,
    reference: extractReference(combined),
    categoryHint: inferCategory(combined, counterparty, channel),
    confidence: (input.sender ? 0.92 : 0.78) * (confident ? 1 : 0.75),
  };
}

export function createMessageFingerprint(input: { bankKey: string; amount: number; type: string; merchant: string; receivedAt: number }) {
  const minute = Math.floor(input.receivedAt / 60);
  return createHash("sha256")
    .update([input.bankKey, input.amount.toFixed(3), input.type, input.merchant.toLowerCase(), minute].join("|"))
    .digest("hex");
}

export type BalanceGap = {
  expectedBalance: number;
  actualBalance: number;
  difference: number;
  direction: TransactionDirection;
};

/**
 * Compares the balance a message reports against what the previous known balance
 * plus this transaction should produce. A non-zero difference means movements
 * happened that we never received a message for, and the sign tells us which way.
 */
export function detectBalanceGap(input: {
  previousBalance: number | null;
  direction: TransactionDirection;
  amount: number;
  balanceAfter: number | null;
}): BalanceGap | null {
  if (input.previousBalance === null || input.balanceAfter === null) return null;

  const signedAmount = input.direction === "credit" ? input.amount : -input.amount;
  const expectedBalance = Number((input.previousBalance + signedAmount).toFixed(3));
  const difference = Number((input.balanceAfter - expectedBalance).toFixed(3));

  if (Math.abs(difference) < 0.001) return null;

  return {
    expectedBalance,
    actualBalance: input.balanceAfter,
    difference,
    direction: difference > 0 ? "credit" : "debit",
  };
}
