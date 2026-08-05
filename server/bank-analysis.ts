import type { BankEmailEvent } from "@shared/schema";
import type { TransactionChannel } from "./bank-message-parser";

export const CHANNEL_LABELS: Record<TransactionChannel, string> = {
  pos: "شراء بالبطاقة",
  atm: "سحب نقدي",
  transfer: "تحويل",
  bill: "فواتير",
  salary: "راتب",
  online: "شراء إلكتروني",
  fee: "رسوم وعمولات",
  other: "أخرى",
};

/**
 * Channels that represent money moving for a reason the user chose in the moment
 * (spending), as opposed to obligations and income that are largely fixed. The
 * split is what makes the personal half of the analysis meaningful.
 */
const DISCRETIONARY_CHANNELS = new Set<string>(["pos", "online", "atm"]);
const COMMITTED_CHANNELS = new Set<string>(["bill", "fee", "transfer"]);

function round(value: number) {
  return Number(value.toFixed(3));
}

function topEntries(counts: Map<string, { total: number; count: number }>, limit: number) {
  return Array.from(counts.entries())
    .map(([label, stats]) => ({ label, total: round(stats.total), count: stats.count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export type BankAnalysis = ReturnType<typeof buildBankAnalysis>;

export function buildBankAnalysis(events: BankEmailEvent[], categoryNames: Map<number, string>) {
  const priced = events.filter((event) => typeof event.amount === "number" && event.amount > 0);

  let totalIn = 0;
  let totalOut = 0;
  const byChannel = new Map<string, { total: number; count: number }>();
  const byCounterparty = new Map<string, { total: number; count: number }>();
  const byCategory = new Map<string, { total: number; count: number }>();
  const byHour = new Array(24).fill(0);
  const byWeekday = new Array(7).fill(0);
  const routes: Array<{ from: string; to: string; amount: number; direction: string; receivedAt: number }> = [];

  let discretionary = 0;
  let committed = 0;

  for (const event of priced) {
    const amount = event.amount as number;
    const direction = event.direction || (event.transactionType === "income" ? "credit" : "debit");
    const channel = event.channel || "other";

    if (direction === "credit") totalIn += amount;
    else totalOut += amount;

    const channelStats = byChannel.get(channel) || { total: 0, count: 0 };
    byChannel.set(channel, { total: channelStats.total + amount, count: channelStats.count + 1 });

    if (direction === "debit") {
      if (DISCRETIONARY_CHANNELS.has(channel)) discretionary += amount;
      if (COMMITTED_CHANNELS.has(channel)) committed += amount;

      const party = event.counterparty || event.merchant || "غير محدد";
      const partyStats = byCounterparty.get(party) || { total: 0, count: 0 };
      byCounterparty.set(party, { total: partyStats.total + amount, count: partyStats.count + 1 });

      const category = event.categoryId ? categoryNames.get(event.categoryId) || "غير مصنّف" : "غير مصنّف";
      const categoryStats = byCategory.get(category) || { total: 0, count: 0 };
      byCategory.set(category, { total: categoryStats.total + amount, count: categoryStats.count + 1 });

      const moment = new Date(event.receivedAt * 1000);
      byHour[moment.getHours()] += amount;
      byWeekday[moment.getDay()] += amount;
    }

    routes.push({
      from: event.fromAccount || (direction === "credit" ? event.counterparty || "جهة خارجية" : "حسابك"),
      to: event.toAccount || (direction === "debit" ? event.counterparty || "جهة خارجية" : "حسابك"),
      amount: round(amount),
      direction,
      receivedAt: event.receivedAt,
    });
  }

  const gaps = events
    .filter((event) => typeof event.gapAmount === "number" && Math.abs(event.gapAmount) >= 0.001)
    .map((event) => ({
      id: event.id,
      receivedAt: event.receivedAt,
      difference: round(event.gapAmount as number),
      direction: (event.gapAmount as number) > 0 ? "credit" : "debit",
      balanceAfter: event.balanceAfter,
    }))
    .sort((a, b) => b.receivedAt - a.receivedAt);

  const debits = priced.filter((event) => (event.direction || (event.transactionType === "income" ? "credit" : "debit")) === "debit");
  const averageSpend = debits.length > 0 ? round(totalOut / debits.length) : 0;
  const largest = debits.reduce<BankEmailEvent | null>(
    (best, event) => (!best || (event.amount as number) > (best.amount as number) ? event : best),
    null,
  );

  const latestWithBalance = events
    .filter((event) => typeof event.balanceAfter === "number")
    .sort((a, b) => b.receivedAt - a.receivedAt)[0];

  const peakHour = byHour.indexOf(Math.max(...byHour));
  const weekdayNames = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const peakWeekday = byWeekday.indexOf(Math.max(...byWeekday));

  return {
    financial: {
      totalIn: round(totalIn),
      totalOut: round(totalOut),
      netFlow: round(totalIn - totalOut),
      transactionCount: priced.length,
      latestBalance: latestWithBalance?.balanceAfter ?? null,
      latestBalanceAt: latestWithBalance?.receivedAt ?? null,
      byChannel: topEntries(byChannel, 8).map((entry) => ({
        ...entry,
        label: CHANNEL_LABELS[entry.label as TransactionChannel] || entry.label,
      })),
      gaps,
      gapTotal: round(gaps.reduce((sum, gap) => sum + gap.difference, 0)),
    },
    personal: {
      discretionarySpend: round(discretionary),
      committedSpend: round(committed),
      discretionaryShare: totalOut > 0 ? Math.round((discretionary / totalOut) * 100) : 0,
      averageSpend,
      largestSpend: largest
        ? { amount: round(largest.amount as number), merchant: largest.counterparty || largest.merchant, receivedAt: largest.receivedAt }
        : null,
      topCounterparties: topEntries(byCounterparty, 5),
      topCategories: topEntries(byCategory, 5),
      peakHour: byHour[peakHour] > 0 ? peakHour : null,
      peakWeekday: byWeekday[peakWeekday] > 0 ? weekdayNames[peakWeekday] : null,
    },
    routes: routes.sort((a, b) => b.receivedAt - a.receivedAt).slice(0, 12),
  };
}
