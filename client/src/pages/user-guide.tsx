import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowRight, BookOpen, CheckCircle2, Goal, Landmark, PieChart, Receipt, Sparkles, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

const USER_GUIDE_STORAGE_KEY = "eltizam-user-guide-seen";
const USER_GUIDE_RETURN_KEY = "eltizam-user-guide-return-visible";
const USER_GUIDE_STEP_KEY = "eltizam-user-guide-active-step";

type GuideStep = {
  title: string;
  description: string;
  details: string[];
  href: string;
  actionLabel: string;
  icon: typeof Wallet;
};

export default function UserGuidePage() {
  const [, setLocation] = useLocation();
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  const guideSteps = useMemo<GuideStep[]>(() => [
    {
      title: "ابدأ بالمحافظ",
      description: "أضف الحسابات أو المحافظ التي تستخدمها حتى يصبح الرصيد واضحًا منذ البداية.",
      details: [
        "أضف كل محفظة أو حساب تريد متابعته.",
        "أدخل الرصيد الحالي لكل محفظة.",
        "بعدها سيظهر لك إجمالي أموالك بشكل أدق.",
      ],
      href: "/wallets",
      actionLabel: "انتقل إلى المحافظ",
      icon: Wallet,
    },
    {
      title: "سجل دخلك",
      description: "أضف مصدر دخلك أو راتبك حتى يبني النظام نظرة أوضح لوضعك المالي.",
      details: [
        "حدد المبلغ الذي يدخل لك بشكل متكرر.",
        "اربطه بمحفظتك المناسبة.",
        "يساعدك ذلك على قراءة خطط الادخار بشكل أفضل.",
      ],
      href: "/income",
      actionLabel: "انتقل إلى الدخل والراتب",
      icon: Landmark,
    },
    {
      title: "أضف معاملاتك اليومية",
      description: "سجل الدخل والمصروفات أولًا بأول حتى تكون أرقامك دقيقة ويعكس النظام واقعك الحقيقي.",
      details: [
        "أضف أي مصروف أو دخل جديد.",
        "اختر القسم والمحفظة المناسبة.",
        "كلما سجلت أكثر كانت التقارير أدق.",
      ],
      href: "/transactions",
      actionLabel: "انتقل إلى المعاملات",
      icon: Receipt,
    },
    {
      title: "نظّم الأقسام",
      description: "قسّم مصروفاتك إلى أقسام مثل الطعام والفواتير والمواصلات حتى تفهم أين تذهب أموالك.",
      details: [
        "أنشئ الأقسام الأساسية لحياتك اليومية.",
        "استخدمها عند تسجيل المعاملات.",
        "ستظهر لك النتائج بوضوح في التقارير.",
      ],
      href: "/categories",
      actionLabel: "انتقل إلى الأقسام",
      icon: PieChart,
    },
    {
      title: "تابع وضعك من التقارير",
      description: "بعد تسجيل بياناتك ستفهم من التقارير أين تنفق أكثر وكيف تحسّن قراراتك المالية.",
      details: [
        "راجع ملخص الإنفاق والدخل.",
        "تعرف على أكثر الأقسام استهلاكًا.",
        "استخدم النتائج لتحسين خطتك الشهرية.",
      ],
      href: "/reports",
      actionLabel: "انتقل إلى التقارير",
      icon: Sparkles,
    },
    {
      title: "خطط وادخر",
      description: "إذا أردت الادخار، أنشئ خطة وهدفًا ادخاريًا وتابع التقدم الفعلي حسب رصيد المحفظة المرتبطة.",
      details: [
        "اختر خطة ادخار تناسب وضعك.",
        "أنشئ هدفًا واربِطه بمحفظة.",
        "تابع المبلغ المحفوظ فعليًا ونسبة التقدم.",
      ],
      href: "/financial-plans?tab=plans",
      actionLabel: "انتقل إلى خطط الادخار",
      icon: Goal,
    },
  ], []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const savedStep = Number(window.localStorage.getItem(USER_GUIDE_STEP_KEY) ?? "0");
    if (!Number.isNaN(savedStep)) {
      setActiveStepIndex(Math.min(Math.max(savedStep, 0), guideSteps.length - 1));
    }
  }, [guideSteps.length]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(USER_GUIDE_STEP_KEY, activeStepIndex.toString());
  }, [activeStepIndex]);

  const activeStep = guideSteps[activeStepIndex];
  const ActiveIcon = activeStep.icon;
  const isLastStep = activeStepIndex === guideSteps.length - 1;

  const markGuideSeen = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(USER_GUIDE_STORAGE_KEY, "true");
    }
  };

  const handleNavigateToStep = () => {
    markGuideSeen();
    if (typeof window !== "undefined") {
      window.localStorage.setItem(USER_GUIDE_RETURN_KEY, "true");
      window.localStorage.setItem(USER_GUIDE_STEP_KEY, activeStepIndex.toString());
    }
    setLocation(activeStep.href);
  };

  const handleFinishGuide = () => {
    markGuideSeen();
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(USER_GUIDE_RETURN_KEY);
      window.localStorage.removeItem(USER_GUIDE_STEP_KEY);
    }
    setLocation("/");
  };

  return (
    <div className="app-page space-y-4 text-right" dir="rtl">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
          <BookOpen className="h-4 w-4" />
          دليل الاستخدام
        </div>
        <h1 className="text-xl font-bold sm:text-2xl">شرح فعلي لطريقة عمل النظام</h1>
        <p className="text-sm leading-7 text-muted-foreground">
          اتبع الخطوات التالية بالترتيب، وكل خطوة ستنقلك مباشرة إلى المكان المناسب لتطبيقها داخل النظام.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="border-border/60 lg:sticky lg:top-20 lg:h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">خطوات البدء</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {guideSteps.map((step, index) => {
              const StepIcon = step.icon;
              const isActive = index === activeStepIndex;
              return (
                <button
                  key={step.title}
                  type="button"
                  onClick={() => setActiveStepIndex(index)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-right transition-colors",
                    isActive ? "border-primary bg-primary/5 text-primary" : "border-border/60 hover:bg-muted"
                  )}
                >
                  <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", isActive ? "bg-primary/10" : "bg-slate-100 text-slate-600")}>
                    <StepIcon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold">{step.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">الخطوة {index + 1}</p>
                  </div>
                  {isActive ? <CheckCircle2 className="h-4 w-4" /> : null}
                </button>
              );
            })}
          </CardContent>
        </Card>

        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-background">
          <CardContent className="space-y-5 p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row-reverse sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <ActiveIcon className="h-6 w-6" />
                </div>
                <h2 className="mt-3 text-lg font-bold sm:text-xl">{activeStep.title}</h2>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">{activeStep.description}</p>
              </div>
              <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-bold text-primary shadow-sm">
                {activeStepIndex + 1} / {guideSteps.length}
              </span>
            </div>

            <div className="space-y-3 rounded-2xl border bg-white p-4">
              <p className="font-bold text-foreground">ماذا تفعل في هذه الخطوة؟</p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {activeStep.details.map((detail) => (
                  <li key={detail} className="flex flex-row-reverse items-start justify-end gap-2">
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="text-right">{detail}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <Button className="w-full sm:w-auto" onClick={handleNavigateToStep}>
                {activeStep.actionLabel}
              </Button>
              <Button variant="outline" className="w-full sm:w-auto" onClick={() => setActiveStepIndex((current) => Math.min(current + 1, guideSteps.length - 1))} disabled={isLastStep}>
                التالي في الشرح
              </Button>
              <Button variant="outline" className="w-full sm:w-auto" onClick={() => setActiveStepIndex((current) => Math.max(current - 1, 0))} disabled={activeStepIndex === 0}>
                السابق
              </Button>
              <Button variant="ghost" className="w-full sm:w-auto text-muted-foreground" onClick={handleFinishGuide}>
                إنهاء الدليل
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
