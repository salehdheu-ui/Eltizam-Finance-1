/**
 * Turns a sentence into a draft commitment.
 *
 * A rules pass runs first and handles the shapes people actually type
 * ("إيجار البيت 300 كل شهر يوم 5"). Claude is consulted only when the rules
 * come back unsure, so the common case costs nothing and the feature works at
 * all without a key configured.
 */

const DAY = 86400;

export type CommitmentDraft = {
  title: string;
  amount: number | null;
  frequency: "one_time" | "daily" | "weekly" | "monthly" | "yearly";
  type: "financial" | "government" | "home" | "vehicle" | "health" | "family" | "work" | "personal";
  dueDate: number | null;
  personName: string | null;
  confidence: number;
  source: "rules" | "claude";
};

const TYPE_HINTS: Array<[CommitmentDraft["type"], RegExp]> = [
  ["vehicle", /سيار|مركب|تأمين\s*المركب|فحص|استمار|بنشر|ملاكي/],
  ["home", /بيت|منزل|إيجار|ايجار|شقة|فيلا|كهرباء|ماء|مياه/],
  ["government", /حكوم|بلدي|رخص|جواز|بطاق|تجديد\s*الإقامة|شرط|محكم|ضريب/],
  ["health", /دكتور|طبيب|مستشفى|عياد|تحليل|أشعة|علاج|دواء/],
  ["family", /أهل|اهل|والد|والدة|أم|أب|أخ|أخت|زوج|ابن|بنت|عائل/],
  ["work", /عمل|شغل|مشروع|عميل|زبون|اجتماع|تسليم|فاتورة\s*عميل/],
  ["financial", /قسط|قرض|دين|سداد|بنك|تمويل|دفع/],
];

/**
 * Arabic has no \b, and these words are prefixes of unrelated ones: unanchored,
 * "شهري" (monthly) matches inside "شهرين" (two months), turning a one-off due in
 * two months into a monthly commitment.
 */
function arabicWord(...alternatives: string[]) {
  return new RegExp(`(?<!\\p{L})(?:${alternatives.join("|")})(?!\\p{L})`, "u");
}

const FREQUENCY_HINTS: Array<[CommitmentDraft["frequency"], RegExp]> = [
  ["daily", arabicWord("كل\\s*يوم", "يومي", "يوميا", "يومياً")],
  ["weekly", arabicWord("كل\\s*(?:أسبوع|اسبوع|جمعة)", "أسبوعي", "اسبوعي", "أسبوعيا")],
  ["monthly", arabicWord("كل\\s*شهر", "شهري", "شهريا", "شهرياً", "بالشهر")],
  ["yearly", arabicWord("كل\\s*(?:سنة|عام)", "سنوي", "سنويا", "سنوياً", "بالسنة")],
];

const WEEKDAYS: Array<[number, RegExp]> = [
  [0, /الأحد|الاحد/], [1, /الإثنين|الاثنين/], [2, /الثلاثاء/], [3, /الأربعاء|الاربعاء/],
  [4, /الخميس/], [5, /الجمعة/], [6, /السبت/],
];

const ARABIC_MONTHS: Array<[number, RegExp]> = [
  [0, /يناير|كانون\s*الثاني/], [1, /فبراير|شباط/], [2, /مارس|آذار|اذار/], [3, /أبريل|ابريل|نيسان/],
  [4, /مايو|أيار|ايار/], [5, /يونيو|حزيران/], [6, /يوليو|تموز/], [7, /أغسطس|اغسطس|آب/],
  [8, /سبتمبر|أيلول|ايلول/], [9, /أكتوبر|اكتوبر|تشرين\s*الأول/], [10, /نوفمبر|تشرين\s*الثاني/],
  [11, /ديسمبر|كانون\s*الأول/],
];

function normalizeDigits(value: string) {
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  return value
    .replace(/[٠-٩]/g, (digit) => String(arabic.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persian.indexOf(digit)))
    .replace(/٫/g, ".")
    .replace(/٬/g, ",");
}

function startOfDay(date: Date) {
  date.setHours(9, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

/** Money, not quantities. "يوم 5" and "كل شهر" carry numbers that are not amounts. */
function extractAmount(text: string) {
  const patterns = [
    /(?:بمبلغ|بقيمة|مبلغ|قيمة)\s*([0-9][0-9,]*(?:\.[0-9]{1,3})?)/,
    /([0-9][0-9,]*(?:\.[0-9]{1,3})?)\s*(?:ر\.?\s?ع|ريال|OMR)/i,
    /(?:OMR|ر\.?\s?ع)\s*([0-9][0-9,]*(?:\.[0-9]{1,3})?)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = Number(match[1].replace(/,/g, ""));
      if (Number.isFinite(value) && value > 0) return value;
    }
  }

  // A bare number is an amount only when nothing else claims it.
  const bare = text.match(/(?<!يوم\s)(?<!رقم\s)\b([0-9]{2,6}(?:\.[0-9]{1,3})?)\b/);
  if (bare) {
    const value = Number(bare[1]);
    if (Number.isFinite(value) && value >= 10) return value;
  }
  return null;
}

function extractDueDate(text: string, now: number): number | null {
  const today = new Date(now * 1000);

  if (/بكرة|بكره|غدا|غداً/.test(text)) return startOfDay(new Date((now + DAY) * 1000));
  if (/اليوم/.test(text)) return startOfDay(new Date(now * 1000));
  if (/بعد\s*(?:غد|بكرة)/.test(text)) return startOfDay(new Date((now + 2 * DAY) * 1000));

  const inDays = text.match(/بعد\s*([0-9]+)\s*(?:يوم|أيام|ايام)/);
  if (inDays) return startOfDay(new Date((now + Number(inDays[1]) * DAY) * 1000));

  const inWeeks = text.match(/بعد\s*([0-9]+)\s*(?:أسبوع|اسبوع|أسابيع|اسابيع)/);
  if (inWeeks) return startOfDay(new Date((now + Number(inWeeks[1]) * 7 * DAY) * 1000));

  const inMonths = text.match(/بعد\s*([0-9]+)\s*(?:شهر|أشهر|اشهر)/);
  if (inMonths) {
    const target = new Date(today);
    target.setMonth(target.getMonth() + Number(inMonths[1]));
    return startOfDay(target);
  }

  // Arabic marks "two of something" with a dual form rather than a number, so
  // "بعد شهرين" carries no digit for the patterns above to find.
  const dual: Array<[RegExp, (date: Date) => void]> = [
    [/بعد\s*(?:يومين)/, (date) => date.setDate(date.getDate() + 2)],
    [/بعد\s*(?:أسبوعين|اسبوعين)/, (date) => date.setDate(date.getDate() + 14)],
    [/بعد\s*(?:شهرين)/, (date) => date.setMonth(date.getMonth() + 2)],
    [/بعد\s*(?:سنتين|عامين)/, (date) => date.setFullYear(date.getFullYear() + 2)],
    [/بعد\s*(?:شهر)(?![؀-ۿ])/, (date) => date.setMonth(date.getMonth() + 1)],
    [/بعد\s*(?:أسبوع|اسبوع)(?![؀-ۿ])/, (date) => date.setDate(date.getDate() + 7)],
    [/بعد\s*(?:سنة|عام)(?![؀-ۿ])/, (date) => date.setFullYear(date.getFullYear() + 1)],
  ];

  for (const [pattern, advance] of dual) {
    if (pattern.test(text)) {
      const target = new Date(today);
      advance(target);
      return startOfDay(target);
    }
  }

  // "يوم 5" — the 5th of this month, or next month if already past.
  const dayOfMonth = text.match(/يوم\s*([0-9]{1,2})\b/);
  if (dayOfMonth) {
    const day = Number(dayOfMonth[1]);
    if (day >= 1 && day <= 31) {
      const target = new Date(today);
      target.setDate(1);
      const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      target.setDate(Math.min(day, lastDay));
      if (Math.floor(target.getTime() / 1000) < now) {
        target.setDate(1);
        target.setMonth(target.getMonth() + 1);
        const nextLast = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
        target.setDate(Math.min(day, nextLast));
      }
      return startOfDay(target);
    }
  }

  const monthMatch = ARABIC_MONTHS.find(([, pattern]) => pattern.test(text));
  if (monthMatch) {
    const dayMatch = text.match(/\b([0-9]{1,2})\b/);
    const target = new Date(today);
    target.setDate(1);
    target.setMonth(monthMatch[0]);
    if (target.getTime() / 1000 < now) target.setFullYear(target.getFullYear() + 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(dayMatch ? Number(dayMatch[1]) : 1, lastDay));
    return startOfDay(target);
  }

  const weekday = WEEKDAYS.find(([, pattern]) => pattern.test(text));
  if (weekday) {
    const target = new Date(today);
    const delta = (weekday[0] - target.getDay() + 7) % 7 || 7;
    target.setDate(target.getDate() + delta);
    return startOfDay(target);
  }

  return null;
}

/** Strips the parts that became structured fields, leaving something readable. */
function extractTitle(text: string) {
  // Date phrases go first: they contain numbers, and the amount pass below would
  // otherwise eat the digit and leave a dangling "يوم" in the title.
  const cleaned = text
    .replace(/يوم\s*[0-9]{1,2}\b/g, " ")
    .replace(/بعد\s*[0-9]+\s*(?:يوم|أيام|ايام|أسبوع|اسبوع|أسابيع|اسابيع|شهر|أشهر|اشهر)/g, " ")
    .replace(/بعد\s*(?:يومين|أسبوعين|اسبوعين|شهرين|سنتين|عامين|شهر|أسبوع|اسبوع|سنة|عام)(?![؀-ۿ])/g, " ")
    .replace(/(?:بمبلغ|بقيمة|مبلغ|قيمة)?\s*[0-9][0-9,]*(?:\.[0-9]{1,3})?\s*(?:ر\.?\s?ع|ريال|OMR)?/gi, " ")
    .replace(/كل\s*(?:يوم|أسبوع|اسبوع|شهر|سنة|عام)/g, " ")
    .replace(/(?:يومي|أسبوعي|اسبوعي|شهري|شهريا|سنوي|سنويا)(?![؀-ۿ])/g, " ")
    .replace(/(?:بكرة|بكره|غدا|غداً|اليوم|تذكرني|ذكرني|أضف|اضف|لازم|يجب|علي|عليّ)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (cleaned || text.trim()).slice(0, 160);
}

export function parseCommitmentText(raw: string, now = Math.floor(Date.now() / 1000)): CommitmentDraft {
  const text = normalizeDigits(raw).replace(/\s+/g, " ").trim();

  const amount = extractAmount(text);
  const frequency = FREQUENCY_HINTS.find(([, pattern]) => pattern.test(text))?.[0] ?? "one_time";
  const type = TYPE_HINTS.find(([, pattern]) => pattern.test(text))?.[0] ?? (amount ? "financial" : "personal");
  const dueDate = extractDueDate(text, now);
  const title = extractTitle(text);

  const person = text.match(/(?:من|إلى|الى|مع)\s+([؀-ۿ]{3,20})(?:\s|$)/);

  // Each field the sentence actually pinned down raises confidence; a bare
  // phrase with none of them is a title and nothing more.
  let confidence = 0.3;
  if (title.length >= 3) confidence += 0.2;
  if (amount !== null) confidence += 0.2;
  if (dueDate !== null) confidence += 0.2;
  if (frequency !== "one_time") confidence += 0.1;

  return {
    title,
    amount,
    frequency,
    type,
    dueDate,
    personName: person?.[1] ?? null,
    confidence: Math.min(1, Number(confidence.toFixed(2))),
    source: "rules",
  };
}

export function isClaudeConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

type ClaudeContent = { type: string; text?: string };

async function askClaude(system: string, user: string, maxTokens = 700) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw Object.assign(new Error("لم يُضبط مفتاح الذكاء الاصطناعي"), { status: 503 });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw Object.assign(new Error(`تعذر الاتصال بالذكاء الاصطناعي (${response.status})`), {
      status: 502,
      publicMessage: "تعذر الاتصال بالذكاء الاصطناعي",
      detail: detail.slice(0, 200),
    });
  }

  const payload = await response.json() as { content?: ClaudeContent[] };
  return (payload.content || []).map((part) => part.text || "").join("").trim();
}

/** Models like to wrap JSON in prose or fences; take the object and ignore the rest. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("لم يُرجع الذكاء الاصطناعي بياناً صالحاً");
  return JSON.parse(candidate.slice(start, end + 1));
}

const DRAFT_SYSTEM = `أنت مساعد يحوّل جملة عربية عامية أو فصحى إلى التزام منظم.
أعد JSON فقط بهذا الشكل، دون أي شرح:
{"title":"نص","amount":رقم أو null,"frequency":"one_time|daily|weekly|monthly|yearly","type":"financial|government|home|vehicle|health|family|work|personal","dayOfMonth":رقم 1-31 أو null,"daysFromNow":رقم أو null,"personName":"نص أو null"}
القواعد: العنوان قصير وواضح بلا أرقام أو تواريخ. المبلغ بالريال العماني فقط إن ذُكر صراحة. استخدم daysFromNow للمواعيد النسبية و dayOfMonth للمتكرر شهرياً.`;

/**
 * Falls back to the rules result whenever Claude is unavailable or returns
 * something unusable, so the feature degrades instead of failing.
 */
export async function understandCommitment(raw: string, now = Math.floor(Date.now() / 1000)): Promise<CommitmentDraft> {
  const rules = parseCommitmentText(raw, now);
  if (rules.confidence >= 0.7 || !isClaudeConfigured()) return rules;

  try {
    const answer = await askClaude(DRAFT_SYSTEM, raw, 400);
    const parsed = extractJson(answer) as {
      title?: string; amount?: number | null; frequency?: string; type?: string;
      dayOfMonth?: number | null; daysFromNow?: number | null; personName?: string | null;
    };

    const frequencies: CommitmentDraft["frequency"][] = ["one_time", "daily", "weekly", "monthly", "yearly"];
    const types: CommitmentDraft["type"][] = ["financial", "government", "home", "vehicle", "health", "family", "work", "personal"];

    let dueDate = rules.dueDate;
    if (typeof parsed.daysFromNow === "number" && parsed.daysFromNow >= 0) {
      dueDate = startOfDay(new Date((now + parsed.daysFromNow * DAY) * 1000));
    } else if (typeof parsed.dayOfMonth === "number" && parsed.dayOfMonth >= 1 && parsed.dayOfMonth <= 31) {
      const target = new Date(now * 1000);
      target.setDate(1);
      const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      target.setDate(Math.min(parsed.dayOfMonth, lastDay));
      if (Math.floor(target.getTime() / 1000) < now) target.setMonth(target.getMonth() + 1);
      dueDate = startOfDay(target);
    }

    return {
      title: (parsed.title || rules.title).slice(0, 160),
      amount: typeof parsed.amount === "number" && parsed.amount > 0 ? parsed.amount : rules.amount,
      frequency: frequencies.includes(parsed.frequency as never) ? parsed.frequency as CommitmentDraft["frequency"] : rules.frequency,
      type: types.includes(parsed.type as never) ? parsed.type as CommitmentDraft["type"] : rules.type,
      dueDate,
      personName: parsed.personName || rules.personName,
      confidence: 0.85,
      source: "claude",
    };
  } catch (error) {
    console.error("Claude commitment parse failed:", error instanceof Error ? error.message : "unknown");
    return rules;
  }
}

const DOCUMENT_SYSTEM = `أنت تقرأ صورة عقد أو فاتورة وتستخرج منها التزاماً.
أعد JSON فقط: {"title":"نص","amount":رقم أو null,"vendor":"نص أو null","dueDateISO":"YYYY-MM-DD أو null","frequency":"one_time|monthly|yearly","notes":"ملخص سطر واحد"}
إن لم تكن المعلومة واضحة في الصورة فاجعلها null. لا تخمّن مبلغاً غير مكتوب.`;

/** Reads a contract or invoice. Requires a key — there is no offline path to
 *  understanding an arbitrary scanned document. */
export async function readDocument(input: { base64: string; mimeType: string }) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw Object.assign(new Error("قراءة المستندات تحتاج مفتاح الذكاء الاصطناعي"), { status: 503 });

  const isPdf = input.mimeType === "application/pdf";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5",
      max_tokens: 900,
      system: DOCUMENT_SYSTEM,
      messages: [{
        role: "user",
        content: [
          {
            type: isPdf ? "document" : "image",
            source: { type: "base64", media_type: input.mimeType, data: input.base64 },
          },
          { type: "text", text: "استخرج الالتزام من هذا المستند." },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw Object.assign(new Error("تعذر قراءة المستند"), { status: 502, detail: detail.slice(0, 200) });
  }

  const payload = await response.json() as { content?: ClaudeContent[] };
  const text = (payload.content || []).map((part) => part.text || "").join("");
  return extractJson(text) as {
    title: string; amount: number | null; vendor: string | null;
    dueDateISO: string | null; frequency: string; notes: string;
  };
}
