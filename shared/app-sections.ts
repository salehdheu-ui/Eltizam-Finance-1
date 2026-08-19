export const APP_SECTION_KEYS = [
  "dashboard",
  "commitments",
  "transactions",
  "reports",
  "shared_commitments",
  "obligations",
  "income",
  "wallets",
  "categories",
  "financial_plans",
  "savings_goals",
  "bank_inbox",
  "settings",
  "user_guide",
] as const;

export type AppSectionKey = (typeof APP_SECTION_KEYS)[number];

export type AppSectionDefinition = {
  key: AppSectionKey;
  label: string;
  href: string;
  description: string;
};

export const DEFAULT_APP_SECTIONS: readonly AppSectionDefinition[] = [
  { key: "dashboard", label: "الرئيسية", href: "/", description: "ملخص اليوم والأولويات" },
  { key: "commitments", label: "التزاماتي", href: "/commitments", description: "إدارة الالتزامات وخطواتها" },
  { key: "transactions", label: "المعاملات", href: "/transactions", description: "الدخل والمصروف والتحويلات" },
  { key: "reports", label: "التقارير", href: "/reports", description: "التقارير والتحليلات المالية" },
  { key: "shared_commitments", label: "مهام مُسندة إليّ", href: "/shared-commitments", description: "المهام الواردة من مستخدمين آخرين" },
  { key: "obligations", label: "الالتزامات المالية", href: "/obligations", description: "الأقساط والدفعات المتكررة" },
  { key: "income", label: "الدخل", href: "/income", description: "مصادر الدخل المتكرر" },
  { key: "wallets", label: "المحافظ", href: "/wallets", description: "الحسابات والمحافظ والأرصدة" },
  { key: "categories", label: "التصنيفات", href: "/categories", description: "تصنيفات المعاملات والميزانيات" },
  { key: "financial_plans", label: "خطط الادخار", href: "/financial-plans", description: "خطط الادخار طويلة المدى" },
  { key: "savings_goals", label: "أهداف الادخار", href: "/savings-goals", description: "متابعة أهداف الادخار" },
  { key: "bank_inbox", label: "البريد البنكي", href: "/bank-inbox", description: "استيراد وتحليل الرسائل البنكية" },
  { key: "settings", label: "الإعدادات", href: "/settings", description: "إعدادات الحساب والإشعارات" },
  { key: "user_guide", label: "دليل الاستخدام", href: "/user-guide", description: "شرح استخدام المنصة" },
];

export function matchesAppSectionPath(section: Pick<AppSectionDefinition, "href">, path: string) {
  if (section.href === "/") return path === "/";
  return path === section.href || path.startsWith(`${section.href}/`);
}
