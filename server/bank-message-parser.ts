import { createHash } from "crypto";

export type BankKey = "bank_muscat" | "nbo" | "bank_dhofar" | "sohar_international" | "ahlibank" | "oman_arab_bank" | "bank_nizwa" | "other";

export type ParsedBankMessage = {
  bankKey: BankKey;
  transactionType: "income" | "expense";
  operation: "deposit" | "purchase" | "withdrawal" | "transfer" | "payment";
  amount: number;
  merchant: string;
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
    .replace(/\u00a0/g, " ");
}

function extractAmount(text: string) {
  const normalized = normalizeDigits(text);
  const patterns = [
    /(?:OMR|ر\.?\s?ع\.?|ريال(?:اً)?\s+عمان(?:ي|ياً)?)\s*[:\-]?\s*([0-9][0-9,]*(?:\.[0-9]{1,3})?)/i,
    /([0-9][0-9,]*(?:\.[0-9]{1,3})?)\s*(?:OMR|ر\.?\s?ع\.?|ريال(?:اً)?\s+عمان(?:ي|ياً)?)/i,
    /(?:amount|المبلغ|بقيمة)\s*[:\-]?\s*([0-9][0-9,]*(?:\.[0-9]{1,3})?)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const amount = Number(match[1].replace(/,/g, ""));
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return null;
}

function findMerchant(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const patterns = [
    /(?:at|to|from|merchant)\s*[:\-]?\s*([^,.;\n]{2,60})/i,
    /(?:لدى|إلى|من|المتجر|التاجر)\s*[:\-]?\s*([^،,.؛\n]{2,60})/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) return match[1].replace(/\s+(?:for|amount|OMR|بقيمة|بمبلغ)\b.*$/i, "").trim();
  }
  return "معاملة بنكية";
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

export function parseBankMessage(input: { bankKey: BankKey; sender: string; subject: string; body: string }): ParsedBankMessage | null {
  const combined = normalizeDigits(`${input.subject}\n${input.body}`);
  const amount = extractAmount(combined);
  if (!amount) return null;

  const income = /credited|credit advice|deposit|salary|received|incoming|إيداع|أضيف|تمت إضافة|راتب|حوالة واردة|مستلمة/i.test(combined);
  const withdrawal = /withdrawal|atm|سحب|صراف/i.test(combined);
  const transfer = /transfer|حوالة|تحويل/i.test(combined);
  const payment = /bill payment|payment|سداد|دفع/i.test(combined);
  const purchase = /purchase|pos|card transaction|شراء|بطاقة/i.test(combined);

  const operation: ParsedBankMessage["operation"] = withdrawal
    ? "withdrawal"
    : transfer
      ? "transfer"
      : payment
        ? "payment"
        : purchase
          ? "purchase"
          : income
            ? "deposit"
            : "purchase";

  return {
    bankKey: input.bankKey,
    transactionType: income ? "income" : "expense",
    operation,
    amount,
    merchant: findMerchant(combined),
    categoryHint: inferCategory(combined),
    confidence: input.sender ? 0.92 : 0.78,
  };
}

export function createMessageFingerprint(input: { bankKey: string; amount: number; type: string; merchant: string; receivedAt: number }) {
  const minute = Math.floor(input.receivedAt / 60);
  return createHash("sha256")
    .update([input.bankKey, input.amount.toFixed(3), input.type, input.merchant.toLowerCase(), minute].join("|"))
    .digest("hex");
}