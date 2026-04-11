import type { Transaction, Wallet } from "@shared/schema";
import { calculateCompoundInterest, getPlanBadge, savingsPlans, type SavingsPlan } from "@/lib/savings-plans";
import { parseNumericInput } from "@/lib/utils";

type NumericLike = string | number | null | undefined;

type MonthlySnapshot = {
  key: string;
  income: number;
  expenses: number;
};

type SavingsPlanAnalysisInput = {
  transactions: Transaction[];
  wallets: Wallet[];
  manualIncome?: NumericLike;
  manualNeeds?: NumericLike;
  manualWants?: NumericLike;
  manualFixedObligations?: NumericLike;
  targetAmount?: NumericLike;
  planYears?: 3 | 5 | 10;
};

export type RankedSavingsPlan = {
  plan: SavingsPlan;
  score: number;
  compatibility: number;
  reasons: string[];
};

export type SavingsPlanCardAnalysis = {
  plan: SavingsPlan;
  rank: number;
  compatibility: number;
  reasons: string[];
  monthlySavingsAmount: number;
  monthlyNeedsAmount: number;
  monthlyWantsAmount: number;
  monthlyReserveAmount: number;
  projectedBalance: number;
  investmentProjection: number;
  monthsToGoal: number | null;
  smartBadge: string;
  isRecommended: boolean;
};

function isRecentTransaction(transaction: Transaction) {
  const transactionDate = new Date(transaction.date);
  const now = new Date();
  const diffDays = (now.getTime() - transactionDate.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays <= 30;
}

function getMonthKey(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function buildMonthlySnapshots(transactions: Transaction[]) {
  const monthlyMap = new Map<string, MonthlySnapshot>();

  for (const transaction of transactions) {
    const key = getMonthKey(transaction.date);
    const existing = monthlyMap.get(key) ?? { key, income: 0, expenses: 0 };

    if (transaction.type === "income") {
      existing.income += transaction.amount;
    }

    if (transaction.type === "expense") {
      existing.expenses += transaction.amount;
    }

    monthlyMap.set(key, existing);
  }

  return Array.from(monthlyMap.values()).sort((a, b) => b.key.localeCompare(a.key));
}

function averageByMonths(months: MonthlySnapshot[], windowSize: number) {
  const selected = months.slice(0, windowSize);

  if (selected.length === 0) {
    return null;
  }

  const totalIncome = selected.reduce((sum, month) => sum + month.income, 0);
  const totalExpenses = selected.reduce((sum, month) => sum + month.expenses, 0);

  return {
    monthCount: selected.length,
    income: totalIncome / selected.length,
    expenses: totalExpenses / selected.length,
  };
}

function getInputValidationMessage(label: string, rawValue: NumericLike, parsedValue: number | null) {
  if (typeof rawValue === "string" && rawValue.trim() && parsedValue === null) {
    return `قيمة ${label} غير مفهومة، تأكد من إدخال رقم صحيح.`;
  }

  if (parsedValue !== null && parsedValue < 0) {
    return `قيمة ${label} لا يمكن أن تكون سالبة.`;
  }

  return null;
}

export function buildSavingsPlanAnalysis({
  transactions,
  wallets,
  manualIncome,
  manualNeeds,
  manualWants,
  manualFixedObligations,
  targetAmount,
  planYears = 5,
}: SavingsPlanAnalysisInput) {
  const totalBalance = wallets.reduce((sum, wallet) => sum + wallet.balance, 0);

  const recentTransactions = transactions.filter(isRecentTransaction);
  const monthlySnapshots = buildMonthlySnapshots(transactions);
  const sixMonthAverage = averageByMonths(monthlySnapshots, 6);
  const threeMonthAverage = averageByMonths(monthlySnapshots, 3);
  const selectedAverage = sixMonthAverage?.monthCount === 6
    ? sixMonthAverage
    : threeMonthAverage?.monthCount === 3
      ? threeMonthAverage
      : null;

  const lastMonthIncome = recentTransactions
    .filter((transaction) => transaction.type === "income")
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  const lastMonthExpenses = recentTransactions
    .filter((transaction) => transaction.type === "expense")
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  const parsedManualIncome = parseNumericInput(manualIncome);
  const parsedManualNeeds = parseNumericInput(manualNeeds);
  const parsedManualWants = parseNumericInput(manualWants);
  const parsedFixedObligations = parseNumericInput(manualFixedObligations);
  const parsedTargetAmount = parseNumericInput(targetAmount);

  const inferredIncome = selectedAverage?.income ?? lastMonthIncome;
  const inferredExpenses = selectedAverage?.expenses ?? lastMonthExpenses;
  const effectiveIncome = parsedManualIncome ?? inferredIncome;
  const hasManualExpenseBreakdown =
    parsedManualNeeds !== null ||
    parsedManualWants !== null ||
    parsedFixedObligations !== null;

  const effectiveNeeds = parsedManualNeeds ?? 0;
  const effectiveWants = parsedManualWants ?? 0;
  const fixedObligations = parsedFixedObligations ?? 0;
  const effectiveExpenses = hasManualExpenseBreakdown
    ? effectiveNeeds + effectiveWants + fixedObligations
    : inferredExpenses;

  const currentSavings = effectiveIncome - effectiveExpenses;
  const currentSavingsRate = effectiveIncome > 0 ? currentSavings / effectiveIncome : 0;
  const targetNum = parsedTargetAmount ?? 0;
  const obligationsRatio = effectiveIncome > 0 ? (effectiveNeeds + fixedObligations) / effectiveIncome : 0;
  const wantsRatio = effectiveIncome > 0 ? effectiveWants / effectiveIncome : 0;
  const analysisWindowLabel = parsedManualIncome !== null
    ? "يدوي"
    : selectedAverage?.monthCount === 6
      ? "متوسط 6 أشهر"
      : selectedAverage?.monthCount === 3
        ? "متوسط 3 أشهر"
        : "آخر 30 يوم";

  const rankedPlans: RankedSavingsPlan[] = effectiveIncome <= 0
    ? savingsPlans.map((plan, index) => ({
        plan,
        score: savingsPlans.length - index,
        compatibility: 50,
        reasons: ["لا توجد بيانات دخل كافية، لذلك نعرض الخطط من الأبسط إلى الأكثر التزاماً."],
      }))
    : savingsPlans
        .map((plan) => {
          let score = 55;
          const reasons: string[] = [];
          const savingsGap = Math.abs(currentSavingsRate - plan.savingsRate);
          const obligationsGap = Math.abs(obligationsRatio - plan.needsRate);
          const wantsGap = Math.abs(wantsRatio - plan.wantsRate);
          const planTargetSavings = effectiveIncome * plan.savingsRate;
          const improvementGap = Math.max(planTargetSavings - Math.max(currentSavings, 0), 0);
          const isStretch = effectiveIncome > 0 && improvementGap > effectiveIncome * 0.08;

          score += Math.max(0, 28 - savingsGap * 100);
          score += Math.max(0, 16 - obligationsGap * 35);
          score += Math.max(0, 10 - wantsGap * 25);

          if (plan.id === "gradual" && (currentSavingsRate < 0.1 || obligationsRatio > 0.72)) {
            score += 18;
            reasons.push("وضعك الحالي يحتاج بداية مريحة وتدرجاً في رفع الادخار.");
          }

          if (plan.id === "50-30-20" && currentSavingsRate >= 0.15 && obligationsRatio <= 0.58) {
            score += 18;
            reasons.push("توازنك الحالي يسمح بخطة متوازنة بين المصروفات والادخار.");
          }

          if (plan.id === "70-20-10" && fixedObligations > 0 && obligationsRatio >= 0.6) {
            score += 18;
            reasons.push("وجود التزامات شهرية واضحة يجعل هذه الخطة أكثر واقعية واستقراراً.");
          }

          if (plan.id === "babylon" && currentSavingsRate >= 0 && currentSavingsRate < 0.14) {
            score += 12;
            reasons.push("الخطة مناسبة لبناء عادة ادخار ثابتة بدون ضغط كبير.");
          }

          if (targetNum > 0 && plan.savingsRate >= 0.2) {
            score += 8;
            reasons.push("وجود هدف ادخاري واضح يجعل الخطط الأعلى ادخاراً أكثر فاعلية.");
          }

          if (targetNum > 0 && isStretch) {
            score -= 10;
            reasons.push("رغم أنها سريعة نحو الهدف، إلا أنها قد تكون متعبة في وضعك الحالي.");
          }

          if (reasons.length === 0) {
            reasons.push("تقييم الخطة بُني على دخلك واحتياجاتك والتزاماتك الحالية.");
          }

          const compatibility = Math.max(45, Math.min(98, Math.round(score)));

          return {
            plan,
            score,
            compatibility,
            reasons,
          };
        })
        .sort((a, b) => b.score - a.score);

  const recommendedPlan = rankedPlans[0]?.plan ?? savingsPlans[0];
  const recommendedPlanAnalysis = rankedPlans[0] ?? null;
  const fastestGoalPlan = targetNum > totalBalance
    ? rankedPlans
        .filter(({ plan }) => effectiveIncome * plan.savingsRate > 0)
        .sort((a, b) => b.plan.savingsRate - a.plan.savingsRate)[0]?.plan ?? null
    : null;

  const planCards: SavingsPlanCardAnalysis[] = rankedPlans.map(({ plan, compatibility, reasons }, index) => {
    const monthlySavingsAmount = effectiveIncome * plan.savingsRate;
    const monthlyNeedsAmount = effectiveIncome * plan.needsRate;
    const monthlyWantsAmount = effectiveIncome * plan.wantsRate;
    const monthlyReserveAmount = effectiveIncome * plan.reserveRate;
    const projectedBalance = totalBalance + monthlySavingsAmount * planYears * 12;
    const investmentProjection = calculateCompoundInterest(totalBalance, monthlySavingsAmount, planYears, 0.08);
    const monthsToGoal = targetNum > totalBalance && monthlySavingsAmount > 0
      ? Math.ceil((targetNum - totalBalance) / monthlySavingsAmount)
      : null;

    return {
      plan,
      rank: index + 1,
      compatibility,
      reasons,
      monthlySavingsAmount,
      monthlyNeedsAmount,
      monthlyWantsAmount,
      monthlyReserveAmount,
      projectedBalance,
      investmentProjection,
      monthsToGoal,
      smartBadge: fastestGoalPlan?.id === plan.id && targetNum > totalBalance ? "الأسرع لهدفك" : getPlanBadge(plan),
      isRecommended: recommendedPlan.id === plan.id,
    };
  });

  const validationMessages = [
    getInputValidationMessage("الدخل الشهري", manualIncome, parsedManualIncome),
    getInputValidationMessage("المصاريف الأساسية", manualNeeds, parsedManualNeeds),
    getInputValidationMessage("الرغبات والكماليات", manualWants, parsedManualWants),
    getInputValidationMessage("الالتزامات الشهرية الثابتة", manualFixedObligations, parsedFixedObligations),
    getInputValidationMessage("الهدف الادخاري", targetAmount, parsedTargetAmount),
  ].filter((message): message is string => Boolean(message));

  if (effectiveIncome > 0 && hasManualExpenseBreakdown && effectiveExpenses > effectiveIncome) {
    validationMessages.push("إجمالي الاحتياجات والرغبات والالتزامات أعلى من الدخل الحالي، لذلك أنت في عجز شهري حالياً.");
  }

  const infoMessages: string[] = [];

  if (recentTransactions.length === 0 && parsedManualIncome === null) {
    infoMessages.push("لا توجد بيانات مالية كافية لآخر 30 يوم، لذلك يعتمد الترشيح الحالي على أقل قدر من المعلومات المتاحة.");
  }

  if (parsedManualIncome === null && selectedAverage?.monthCount === 6) {
    infoMessages.push("تم احتساب الدخل والمصروفات تلقائياً باستخدام متوسط آخر 6 أشهر لتقليل أثر الأشهر الاستثنائية.");
  } else if (parsedManualIncome === null && selectedAverage?.monthCount === 3) {
    infoMessages.push("تم احتساب الدخل والمصروفات تلقائياً باستخدام متوسط آخر 3 أشهر للحصول على قراءة أكثر استقراراً.");
  }

  if (currentSavings < 0) {
    infoMessages.push("وضعك الحالي يشير إلى عجز شهري، لذا قد تكون الخطط المتدرجة أو المحافظة أنسب كبداية.");
  }

  if (targetNum > 0 && targetNum <= totalBalance) {
    infoMessages.push("هدفك الادخاري الحالي أقل من أو يساوي رصيدك الحالي، لذلك تركيز المقارنة سيكون على الاستدامة أكثر من سرعة الوصول.");
  }

  infoMessages.push("تقدير الاستثمار على 8% هو سيناريو افتراضي للتوضيح وليس وعداً بعائد فعلي ثابت.");

  const improvementGap = Math.max((recommendedPlan.savingsRate * effectiveIncome) - Math.max(currentSavings, 0), 0);
  const exampleIncome = effectiveIncome > 0 ? effectiveIncome : 1000;
  const monthlyStepTarget = improvementGap > 0 ? Math.min(improvementGap, Math.max(effectiveIncome * 0.05, 10)) : 0;
  const transitionPlan = improvementGap <= 0
    ? {
        title: "أنت قريب من الخطة الموصى بها",
        description: "يمكنك البدء بالخطة الحالية مباشرة مع متابعة الالتزام شهرياً.",
        steps: [
          "ثبّت الادخار الحالي في بداية كل شهر قبل الإنفاق المرن.",
          "راجع الرغبات شهرياً للحفاظ على الاستدامة.",
        ],
      }
    : currentSavings < 0
      ? {
          title: "ابدأ بإيقاف العجز أولاً",
          description: "الأولوية هذا الشهر هي تقليل العجز قبل الانتقال الكامل للخطة الموصى بها.",
          steps: [
            `خفّض بند الرغبات أو المصروفات المرنة بما لا يقل عن ${monthlyStepTarget.toFixed(2)} شهرياً.`,
            "امنع أي التزامات إضافية مؤقتاً حتى يعود الفائض إلى المنطقة الإيجابية.",
            `بعد معالجة العجز، ارفع الادخار تدريجياً حتى تصل إلى فجوة التحسين الكاملة (${improvementGap.toFixed(2)}).`,
          ],
        }
      : {
          title: "خطة انتقال تدريجية",
          description: "الخطة الموصى بها مناسبة، لكن من الأفضل الوصول لها على مراحل قصيرة وواضحة.",
          steps: [
            `ابدأ هذا الشهر برفع الادخار بمقدار ${monthlyStepTarget.toFixed(2)}.`,
            `خفّض بند الرغبات أو الإنفاق المرن بالقيمة نفسها تقريباً للحفاظ على التوازن.`,
            `كرر الزيادة شهرياً حتى تغلق فجوة التحسين الكاملة (${improvementGap.toFixed(2)}).`,
          ],
        };

  return {
    totalBalance,
    lastMonthIncome,
    lastMonthExpenses,
    inferredIncome,
    inferredExpenses,
    parsedManualIncome,
    parsedManualNeeds,
    parsedManualWants,
    parsedFixedObligations,
    parsedTargetAmount,
    effectiveIncome,
    effectiveNeeds,
    effectiveWants,
    fixedObligations,
    hasManualExpenseBreakdown,
    effectiveExpenses,
    currentSavings,
    currentSavingsRate,
    targetNum,
    obligationsRatio,
    wantsRatio,
    rankedPlans,
    recommendedPlan,
    recommendedPlanAnalysis,
    fastestGoalPlan,
    planCards,
    improvementGap,
    exampleIncome,
    validationMessages,
    infoMessages,
    analysisWindowLabel,
    transitionPlan,
    monthlySnapshotsCount: monthlySnapshots.length,
    hasRecentTransactions: recentTransactions.length > 0,
  };
}
