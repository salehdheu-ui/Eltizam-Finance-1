export const DASHBOARD_SECTION_KEYS = [
  "focus_summary",
  "weekly_insights",
  "priorities",
  "upcoming_obligations",
  "financial_summary",
  "recent_transactions",
] as const;

export type DashboardSectionKey = (typeof DASHBOARD_SECTION_KEYS)[number];

export type DashboardSectionDefinition = {
  key: DashboardSectionKey;
  label: string;
  description: string;
};

export const DEFAULT_DASHBOARD_SECTIONS: readonly DashboardSectionDefinition[] = [
  { key: "focus_summary", label: "نظرة اليوم", description: "البطاقة الزرقاء وملخص المتأخر واليوم والأسبوع والإجراءات السريعة" },
  { key: "weekly_insights", label: "أسبوعك والتحليلات", description: "ملخص الأسبوع والتنبيهات والمصاريف المتكررة ومحاكاة الالتزام" },
  { key: "priorities", label: "الأولوية الآن", description: "أقرب الالتزامات مع التصفية والإنجاز السريع" },
  { key: "upcoming_obligations", label: "دفعات قريبة", description: "الالتزامات المالية المتوقع استحقاقها قريباً" },
  { key: "financial_summary", label: "المال باختصار", description: "الرصيد والدخل والمصروف في بطاقة مختصرة" },
  { key: "recent_transactions", label: "آخر المعاملات", description: "أحدث ثلاث معاملات مالية" },
];
