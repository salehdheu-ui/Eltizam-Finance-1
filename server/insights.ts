import type { Transaction } from "@shared/schema";

const DAY = 86400;

export type Risk = {
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
};

export type RecurringCandidate = {
  label: string;
  averageAmount: number;
  occurrences: number;
  averageGapDays: number;
  suggestedFrequency: "monthly" | "weekly" | "yearly";
  lastSeen: number;
};

type PricedTransaction = Pick<Transaction, "amount" | "type" | "date" | "note" | "categoryId">;

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function round(value: number) {
  return Number(value.toFixed(3));
}

/** The payee a bank-imported note describes, which is what makes two charges
 *  comparable across months. */
function labelOf(note: string | null | undefined) {
  const text = (note || "").trim();
  const marker = "من البريد البنكي · ";
  return text.startsWith(marker) ? text.slice(marker.length).trim() : text;
}

/**
 * Charges that keep coming back from the same payee at a steady interval. These
 * are subscriptions and bills the user never told the app about, so surfacing
 * them turns a surprise into a commitment they can plan around.
 */
export function detectRecurring(transactions: PricedTransaction[], today = Math.floor(Date.now() / 1000)): RecurringCandidate[] {
  const groups = new Map<string, PricedTransaction[]>();

  for (const transaction of transactions) {
    if (transaction.type !== "expense") continue;
    const label = labelOf(transaction.note);
    if (label.length < 2) continue;
    groups.set(label, [...(groups.get(label) ?? []), transaction]);
  }

  const candidates: RecurringCandidate[] = [];

  for (const [label, entries] of Array.from(groups.entries())) {
    if (entries.length < 3) continue;

    const dates = entries.map((entry) => entry.date).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let index = 1; index < dates.length; index += 1) {
      gaps.push((dates[index] - dates[index - 1]) / DAY);
    }

    const typicalGap = median(gaps);
    if (typicalGap < 5 || typicalGap > 400) continue;

    // A real subscription arrives on a rhythm. Wildly uneven gaps mean the payee
    // is just somewhere the user happens to shop often.
    const spread = median(gaps.map((gap) => Math.abs(gap - typicalGap)));
    if (spread > typicalGap * 0.35) continue;

    const amounts = entries.map((entry) => entry.amount);
    const typicalAmount = median(amounts);
    if (typicalAmount <= 0) continue;

    const suggestedFrequency = typicalGap <= 10 ? "weekly" : typicalGap <= 45 ? "monthly" : "yearly";

    candidates.push({
      label,
      averageAmount: round(typicalAmount),
      occurrences: entries.length,
      averageGapDays: Math.round(typicalGap),
      suggestedFrequency,
      lastSeen: dates[dates.length - 1],
    });
  }

  return candidates.sort((a, b) => b.averageAmount * b.occurrences - a.averageAmount * a.occurrences).slice(0, 10);
}

/**
 * Things worth knowing before they become problems. Every risk states the number
 * behind it, because a warning the user cannot verify is one they learn to ignore.
 */
export function detectRisks(input: {
  transactions: PricedTransaction[];
  walletBalance: number;
  upcoming: Array<{ title: string; dueDate: number; amount: number | null; status: string }>;
  today?: number;
}): Risk[] {
  const today = input.today ?? Math.floor(Date.now() / 1000);
  const risks: Risk[] = [];

  const last30 = input.transactions.filter((transaction) => transaction.date >= today - 30 * DAY);
  const previous30 = input.transactions.filter(
    (transaction) => transaction.date >= today - 60 * DAY && transaction.date < today - 30 * DAY,
  );

  const spend = (rows: PricedTransaction[]) =>
    rows.filter((row) => row.type === "expense").reduce((sum, row) => sum + row.amount, 0);

  const currentSpend = spend(last30);
  const priorSpend = spend(previous30);

  // Money already promised in the next month, against what is actually there.
  const committedSoon = input.upcoming
    .filter((item) => item.status !== "completed" && item.dueDate <= today + 30 * DAY)
    .reduce((sum, item) => sum + (item.amount ?? 0), 0);

  if (committedSoon > 0 && committedSoon > input.walletBalance) {
    risks.push({
      severity: "high",
      title: "التزامات الشهر أكبر من رصيدك",
      detail: `عليك ${round(committedSoon)} ر.ع خلال 30 يوماً، ورصيدك ${round(input.walletBalance)} ر.ع — الفرق ${round(committedSoon - input.walletBalance)} ر.ع.`,
    });
  }

  const overdue = input.upcoming.filter((item) => item.status === "missed");
  if (overdue.length > 0) {
    risks.push({
      severity: overdue.length >= 3 ? "high" : "medium",
      title: `${overdue.length} التزام متأخر`,
      detail: overdue.slice(0, 3).map((item) => item.title).join("، ") + (overdue.length > 3 ? "، وغيرها" : ""),
    });
  }

  if (priorSpend > 0 && currentSpend > priorSpend * 1.4) {
    risks.push({
      severity: "medium",
      title: "صرفك ارتفع بشكل ملحوظ",
      detail: `أنفقت ${round(currentSpend)} ر.ع هذا الشهر مقابل ${round(priorSpend)} في الذي قبله — زيادة ${Math.round(((currentSpend - priorSpend) / priorSpend) * 100)}%.`,
    });
  }

  // Runway: at the current burn rate, how long the balance lasts.
  const dailyBurn = currentSpend / 30;
  if (dailyBurn > 0 && input.walletBalance > 0) {
    const runwayDays = Math.floor(input.walletBalance / dailyBurn);
    if (runwayDays < 21) {
      risks.push({
        severity: runwayDays < 10 ? "high" : "medium",
        title: `رصيدك يكفي ${runwayDays} يوماً`,
        detail: `بمعدل صرفك الحالي ${round(dailyBurn)} ر.ع يومياً.`,
      });
    }
  }

  // Needs enough transactions to be a pattern rather than an artifact: with two
  // purchases one of them is always "most of the spending", which tells nobody
  // anything and teaches the user to ignore the warnings that do matter.
  const expenses = last30.filter((row) => row.type === "expense");
  const largest = [...expenses].sort((a, b) => b.amount - a.amount)[0];
  if (largest && expenses.length >= 5 && currentSpend > 0 && largest.amount > currentSpend * 0.4) {
    risks.push({
      severity: "low",
      title: "عملية واحدة ابتلعت جزءاً كبيراً من صرفك",
      detail: `${labelOf(largest.note) || "معاملة"} بمبلغ ${round(largest.amount)} ر.ع — ${Math.round((largest.amount / currentSpend) * 100)}% من صرف الشهر.`,
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  return risks.sort((a, b) => order[a.severity] - order[b.severity]);
}

/**
 * Answers "what if I commit to this?" against the money actually left after
 * everything already promised — the number that decides whether it is affordable.
 */
export function simulateDecision(input: {
  monthlyIncome: number;
  walletBalance: number;
  committedMonthly: number;
  newMonthlyCost: number;
  months: number;
}) {
  const months = Math.max(1, Math.min(120, input.months));
  const freeBefore = input.monthlyIncome - input.committedMonthly;
  const freeAfter = freeBefore - input.newMonthlyCost;
  const totalCost = input.newMonthlyCost * months;

  const projectedBalance = input.walletBalance + freeAfter * months;
  const commitmentRatio = input.monthlyIncome > 0
    ? (input.committedMonthly + input.newMonthlyCost) / input.monthlyIncome
    : 1;

  let verdict: "comfortable" | "tight" | "unaffordable";
  let advice: string;

  if (freeAfter < 0) {
    verdict = "unaffordable";
    advice = `سيتجاوز التزامك دخلك بـ ${round(Math.abs(freeAfter))} ر.ع شهرياً.`;
  } else if (commitmentRatio > 0.5 || freeAfter < input.monthlyIncome * 0.15) {
    verdict = "tight";
    advice = `سيبقى لك ${round(freeAfter)} ر.ع شهرياً فقط، والالتزامات ستأخذ ${Math.round(commitmentRatio * 100)}% من دخلك.`;
  } else {
    verdict = "comfortable";
    advice = `سيبقى لك ${round(freeAfter)} ر.ع شهرياً بعد كل التزاماتك.`;
  }

  return {
    verdict,
    advice,
    freeBefore: round(freeBefore),
    freeAfter: round(freeAfter),
    totalCost: round(totalCost),
    projectedBalance: round(projectedBalance),
    commitmentRatio: Math.round(commitmentRatio * 100),
  };
}

/** The week in the few numbers worth reading, plus what needs attention next. */
export function buildWeeklySummary(input: {
  transactions: PricedTransaction[];
  upcoming: Array<{ title: string; dueDate: number; amount: number | null; status: string }>;
  today?: number;
}) {
  const today = input.today ?? Math.floor(Date.now() / 1000);
  const week = input.transactions.filter((transaction) => transaction.date >= today - 7 * DAY);

  const spent = week.filter((row) => row.type === "expense").reduce((sum, row) => sum + row.amount, 0);
  const received = week.filter((row) => row.type === "income").reduce((sum, row) => sum + row.amount, 0);

  const priorWeek = input.transactions.filter(
    (transaction) => transaction.date >= today - 14 * DAY && transaction.date < today - 7 * DAY,
  );
  const priorSpent = priorWeek.filter((row) => row.type === "expense").reduce((sum, row) => sum + row.amount, 0);

  const nextSeven = input.upcoming
    .filter((item) => item.status !== "completed" && item.dueDate <= today + 7 * DAY)
    .sort((a, b) => a.dueDate - b.dueDate);

  const byLabel = new Map<string, number>();
  for (const row of week) {
    if (row.type !== "expense") continue;
    const label = labelOf(row.note) || "غير محدد";
    byLabel.set(label, (byLabel.get(label) ?? 0) + row.amount);
  }
  const topSpend = Array.from(byLabel.entries())
    .map(([label, total]) => ({ label, total: round(total) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);

  const change = priorSpent > 0 ? Math.round(((spent - priorSpent) / priorSpent) * 100) : null;

  return {
    spent: round(spent),
    received: round(received),
    net: round(received - spent),
    transactionCount: week.length,
    changeVsPriorWeek: change,
    topSpend,
    dueNext7Days: nextSeven.slice(0, 5).map((item) => ({
      title: item.title,
      dueDate: item.dueDate,
      amount: item.amount,
      overdue: item.status === "missed",
    })),
    dueTotal: round(nextSeven.reduce((sum, item) => sum + (item.amount ?? 0), 0)),
  };
}
