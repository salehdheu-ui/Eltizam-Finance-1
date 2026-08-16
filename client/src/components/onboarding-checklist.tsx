import { ArrowLeft, Check, Circle, ListChecks, PiggyBank, ReceiptText, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCommitments, useDashboard, useObligations, useRecurringIncomes, useWallets } from "@/lib/hooks";

const DISMISS_KEY = "eltizam-onboarding-dismissed";

type Step = {
  id: string;
  title: string;
  description: string;
  href: string;
  icon: typeof WalletCards;
  complete: boolean;
};

export default function OnboardingChecklist() {
  const [dismissed, setDismissed] = useState(false);
  const { data: wallets = [], isLoading: walletsLoading } = useWallets();
  const { data: dashboard, isLoading: dashboardLoading } = useDashboard();
  const { data: commitments = [], isLoading: commitmentsLoading } = useCommitments();
  const { data: obligations = [], isLoading: obligationsLoading } = useObligations();
  const { data: recurringIncomes = [], isLoading: recurringLoading } = useRecurringIncomes();

  useEffect(() => {
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === "true");
  }, []);

  const steps = useMemo<Step[]>(() => [
    {
      id: "wallet",
      title: "أنشئ أول محفظة",
      description: "أضف حسابك البنكي أو محفظتك النقدية لتبدأ من رصيد صحيح.",
      href: "/wallets",
      icon: WalletCards,
      complete: wallets.length > 0,
    },
    {
      id: "transaction",
      title: "سجّل أول معاملة",
      description: "سجّل دخلاً أو مصروفاً واحداً حتى يبدأ ملخصك المالي بالظهور.",
      href: "/transactions",
      icon: ReceiptText,
      complete: (dashboard?.recentTransactions?.length ?? 0) > 0,
    },
    {
      id: "commitment",
      title: "أضف أول التزام",
      description: "حوّل الموعد أو القسط أو المهمة المهمة إلى متابعة واضحة.",
      href: "/commitments",
      icon: ListChecks,
      complete: commitments.length > 0,
    },
    {
      id: "obligation",
      title: "عرّف دفعة قادمة",
      description: "أضف فاتورة أو اشتراكاً حتى ترى ما يقترب قبل موعده.",
      href: "/obligations",
      icon: ReceiptText,
      complete: obligations.length > 0,
    },
    {
      id: "income",
      title: "ثبّت دخلك المتكرر",
      description: "أضف الراتب أو دخلاً شهرياً لتحصل على صورة أدق للمتاح.",
      href: "/income",
      icon: PiggyBank,
      complete: recurringIncomes.length > 0,
    },
  ], [wallets, dashboard, commitments, obligations, recurringIncomes]);

  const completedCount = steps.filter((step) => step.complete).length;
  const isLoading = walletsLoading || dashboardLoading || commitmentsLoading || obligationsLoading || recurringLoading;
  const isFinished = completedCount === steps.length;
  const shouldShow = !dismissed && !isFinished && (completedCount < 3 || wallets.length === 0);

  if (isLoading || !shouldShow) {
    return null;
  }

  const nextStep = steps.find((step) => !step.complete) ?? steps[steps.length - 1];
  const progress = Math.round((completedCount / steps.length) * 100);

  const dismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  };

  return (
    <Card className="overflow-hidden border-primary/15 bg-gradient-to-br from-primary/[0.07] via-background to-background shadow-sm" dir="rtl">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-primary">
              <ListChecks className="h-5 w-5" />
              <p className="text-sm font-bold">ابدأ بخطوات بسيطة</p>
            </div>
            <h2 className="mt-2 text-lg font-black">جهّز التزامك في دقائق</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">أكمل الخطوة التالية فقط، وسيتولى النظام ترتيب التفاصيل معك.</p>
          </div>
          <span className="shrink-0 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">{completedCount}/{steps.length}</span>
        </div>

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-primary/10" aria-label={`اكتمل ${progress}% من التهيئة`}>
          <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>

        <Link href={nextStep.href}>
          <div className="mt-4 flex cursor-pointer items-center gap-3 rounded-2xl border border-primary/15 bg-background/90 p-3 transition-colors hover:bg-primary/[0.04]">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <nextStep.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">الخطوة التالية: {nextStep.title}</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{nextStep.description}</p>
            </div>
            <ArrowLeft className="h-4 w-4 shrink-0 text-primary" />
          </div>
        </Link>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <Link key={step.id} href={step.href}>
                <div className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm transition-colors hover:bg-muted/60">
                  {step.complete ? <Check className="h-4 w-4 shrink-0 text-emerald-600" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground/50" />}
                  <Icon className={cn("h-4 w-4 shrink-0", step.complete ? "text-emerald-600" : "text-muted-foreground")} />
                  <span className={cn("truncate", step.complete ? "text-muted-foreground line-through" : "font-medium")}>{step.title}</span>
                </div>
              </Link>
            );
          })}
        </div>

        <Button variant="ghost" size="sm" className="mt-3 h-8 px-2 text-xs text-muted-foreground" onClick={dismiss}>
          إخفاء التهيئة الآن
        </Button>
      </CardContent>
    </Card>
  );
}
