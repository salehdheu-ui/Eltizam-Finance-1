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

function maskAccount(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 4) return value.trim();
  return `••••${digits.slice(-4)}`;
}

function extractAccounts(text: string) {
  const fromPatterns = [
    new RegExp(String.raw`(?:from|debited\s+from)\s+(?:your\s+)?(?:a\/c|acc(?:ount)?|card)\s*(?:no\.?|number)?\s*[:\-]?\s*([X\*x•\d\-]{4,25})`, "i"),
    new RegExp(String.raw`من\s*(?:حسابك|الحساب|بطاقتك|البطاقة)\s*(?:رقم)?\s*[:\-]?\s*([X\*x•\d\-]{4,25})`, ""),
  ];
  const toPatterns = [
    new RegExp(String.raw`(?:to|credited\s+to)\s+(?:a\/c|acc(?:ount)?|card)\s*(?:no\.?|number)?\s*[:\-]?\s*([X\*x•\d\-]{4,25})`, "i"),
    new RegExp(String.raw`إلى\s*(?:حساب|الحساب|بطاقة|البطاقة)\s*(?:رقم)?\s*[:\-]?\s*([X\*x•\d\-]{4,25})`, ""),
  ];

  const first = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return maskAccount(match[1]);
    }
    return null;
  };

  return { fromAccount: first(fromPatterns), toAccount: first(toPatterns) };
}

function extractCounterparty(text: string) {
  const patterns = [
    /(?:at|merchant)\s*[:\-]?\s*([^,.;\n]{2,60})/i,
    /(?:paid\s+to|transferred\s+to|to)\s+([A-Z][^,.;\n]{2,60})/,
    /(?:received\s+from|transferred\s+from|from)\s+([A-Z][^,.;\n]{2,60})/,
    /(?:لدى|المتجر|التاجر)\s*[:\-]?\s*([^،,.؛\n]{2,60})/,
    /(?:إلى|من)\s+(?!حساب|الحساب|بطاقة|البطاقة)([^،,.؛\n]{2,60})/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const cleaned = cleanEntity(match[1]);
      if (cleaned.length >= 2) return cleaned;
    }
  }
  return null;
}

function extractReference(text: string) {
  const match = text.match(/(?:ref(?:erence)?|txn|transaction)\s*(?:no\.?|id|#)?\s*[:\-]?\s*([A-Za-z0-9\-]{4,30})/i)
    || text.match(/(?:المرجع|رقم\s*العملية|رقم\s*المرجع)\s*[:\-]?\s*([A-Za-z0-9\-]{4,30})/);
  return match?.[1] ?? null;
}

function inferCategory(text: string) {
  const rules: Array<[string, RegExp]> = [
    ["مطاعم", /restaurant|cafe|coffee|مطعم|مقهى/i],
    ["وقود", /fuel|petrol|shell|oman oil|نفط|وقود/i],
    ["اتصالات", /omantel|ooredoo|vodafone|telecom|اتصالات/i],
    ["بقالة", /grocery|supermarket|lulu|carrefour|nesto|بقالة|سوبرماركت/i],
    ["صحة", /hospital|clinic|pharmacy|صيدلية|مستشفى|عيادة/i],
    ["فواتير", /electricity|water|bill|كهرباء|مياه|فاتورة/i],
    ["تسوق", /mall|store|shop|amazon|متجر|تسوق/i],
    ["راتب", /salary|payroll|راتب/i],
  ];
  return rules.find(([, rule]) => rule.test(text))?.[0] ?? null;
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

export function buildBankSearchQuery(bankKey: BankKey, customSenders?: string | string[] | null) {
  const senders = resolveAllowedSenders(bankKey, customSenders);
  if (senders.length === 0) return null;
  const senderQuery = senders.map((sender) => `from:(${sender})`).join(" OR ");
  return `newer_than:30d (${senderQuery})`;
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
    reference: extractReference(combined),
    categoryHint: inferCategory(combined),
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
