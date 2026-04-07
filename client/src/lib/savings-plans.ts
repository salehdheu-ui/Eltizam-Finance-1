export type SavingsPlan = {
  id: string;
  title: string;
  subtitle: string;
  savingsRate: number;
  needsRate: number;
  wantsRate: number;
  reserveRate: number;
  description: string;
  highlights: string[];
  bestFor: string;
  caution: string;
  detailedPoints: string[];
};

export const savingsPlans: SavingsPlan[] = [
  {
    id: "babylon",
    title: "ادفع لنفسك أولاً",
    subtitle: "مستوحاة من The Richest Man in Babylon",
    savingsRate: 0.1,
    needsRate: 0.7,
    wantsRate: 0.15,
    reserveRate: 0.05,
    description: "احجز 10% من دخلك أولاً قبل أي صرف حتى تبني أصل الادخار والانضباط المالي.",
    highlights: ["بداية ممتازة", "تبني عادة ادخار", "سهلة التطبيق شهرياً"],
    bestFor: "المبتدئ أو من يريد عادة ادخار سهلة وواضحة.",
    caution: "قد تكون بطيئة إذا كان هدفك كبيراً وتحتاج الوصول إليه بسرعة.",
    detailedPoints: [
      "الفكرة الأساسية أن تخصم جزء الادخار أولاً ثم تتعامل مع بقية الدخل.",
      "النسبة المقترحة هنا 10% ادخار مع توزيع مريح لبقية المصروفات.",
      "مناسبة إذا كنت تريد الالتزام بدون ضغط كبير في البداية.",
    ],
  },
  {
    id: "50-30-20",
    title: "خطة 50 / 30 / 20",
    subtitle: "الأشهر عالمياً للتوازن المالي",
    savingsRate: 0.2,
    needsRate: 0.5,
    wantsRate: 0.3,
    reserveRate: 0,
    description: "تقسم دخلك بين الاحتياجات والرغبات والادخار بطريقة متوازنة ومناسبة لمعظم الناس.",
    highlights: ["متوازنة", "واضحة", "مناسبة لمعظم المستخدمين"],
    bestFor: "من لديه دخل مستقر ويريد توازناً واضحاً بين الاحتياجات والرغبات والادخار.",
    caution: "قد لا تكون الأنسب إذا كانت التزاماتك الشهرية مرتفعة جداً.",
    detailedPoints: [
      "تخصص 50% للاحتياجات، 30% للرغبات، و20% للادخار.",
      "تساعدك على الاستمرار دون شعور بحرمان كبير.",
      "تعمل جيداً عندما تكون مصاريفك الأساسية تحت السيطرة.",
    ],
  },
  {
    id: "70-20-10",
    title: "خطة 70 / 20 / 10",
    subtitle: "عملية لمن لديه التزامات واضحة",
    savingsRate: 0.2,
    needsRate: 0.7,
    wantsRate: 0,
    reserveRate: 0.1,
    description: "تناسب من يركز على الاستقرار والاحتياطي مع تقليل الهدر في الكماليات.",
    highlights: ["قوية للأسر", "تعزز الاحتياطي", "تخدم الالتزامات الشهرية"],
    bestFor: "من لديه مسؤوليات أو أقساط ويريد خطة عملية ومحافظة.",
    caution: "قد تكون مقيدة إذا كنت تحتاج مساحة أكبر للرغبات أو الترفيه.",
    detailedPoints: [
      "تعطي الأولوية للاحتياجات والالتزامات مع ادخار ثابت واحتياطي منفصل.",
      "مفيدة للأسر أو لمن لديهم التزامات شهرية مستمرة.",
      "تساعد على تقليل الهدر عندما تكون المصاريف المرتفعة تضغط على الميزانية.",
    ],
  },
  {
    id: "gradual",
    title: "خطة التدرج الذكي",
    subtitle: "ابدأ صغيراً ثم ارفع الادخار تدريجياً",
    savingsRate: 0.15,
    needsRate: 0.65,
    wantsRate: 0.15,
    reserveRate: 0.05,
    description: "مناسبة لمن يريد الدخول في الادخار بشكل مريح ثم زيادة النسبة مع الوقت.",
    highlights: ["مريحة نفسياً", "سهلة الالتزام", "مناسبة بعد التعثر المالي"],
    bestFor: "من يجد صعوبة في الالتزام بخطة قوية من البداية أو يمر بمرحلة تعافٍ مالي.",
    caution: "تحتاج متابعة شهرية حتى لا تتوقف عند البداية دون تطوير.",
    detailedPoints: [
      "توفر بداية مريحة بدل القفز مباشرة إلى نسبة ادخار عالية.",
      "مفيدة إذا كان وضعك الحالي لا يتحمل تغييراً حاداً في المصروفات.",
      "الأفضل أن ترفع الادخار تدريجياً كلما تحسن انضباطك أو دخلك.",
    ],
  },
];

export function calculateCompoundInterest(principal: number, monthlyContribution: number, years: number, annualRate: number) {
  const monthlyRate = annualRate / 12;
  const totalMonths = years * 12;
  let total = principal;

  for (let i = 0; i < totalMonths; i++) {
    total = total * (1 + monthlyRate) + monthlyContribution;
  }

  return total;
}

export function getSavingsDistributionLabel(plan: SavingsPlan) {
  return `${Math.round(plan.needsRate * 100)}% احتياجات - ${Math.round(plan.wantsRate * 100)}% رغبات - ${Math.round(plan.savingsRate * 100)}% ادخار${plan.reserveRate > 0 ? ` - ${Math.round(plan.reserveRate * 100)}% احتياطي` : ""}`;
}

export function getPlanBadge(plan: SavingsPlan) {
  if (plan.id === "50-30-20") {
    return "الأكثر توازناً";
  }

  if (plan.id === "gradual") {
    return "الأكثر راحة للبداية";
  }

  if (plan.id === "70-20-10") {
    return "الأفضل لأصحاب الالتزامات";
  }

  return "الأفضل لبناء العادة";
}
