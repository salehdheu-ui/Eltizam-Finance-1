import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ArrowRight, Building2, CheckCircle2, Inbox, Loader2, Mail, RefreshCw, ShieldCheck, Sparkles, Trash2, Unplug, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCategories, useCommitments, useWallets } from "@/lib/hooks";
import { CurrencyDisplay } from "@/components/ui/currency-display";
import { formatCurrency } from "@/lib/utils";

 type BankInboxData = {
  providers: {
    google: { configured: boolean };
    microsoft: { configured: boolean };
  };
  banks: Array<{ key: string; name: string; requiresCustomSender: boolean }>;
  detectedAccounts: Array<{ accountRef: string; connectionId: number; count: number }>;
  orphanedImports: { events: number; transactions: number };
  unknownAdjustments: { count: number; total: number };
  connections: Array<{
    id: number;
    provider: string;
    email: string;
    bankKey: string;
    customSenders: string | null;
    accountFilter: string | null;
    walletId: number;
    autoImport: boolean;
    lastSyncAt: number | null;
    lastSyncAttemptAt: number | null;
    lastStatus: string;
    lastError: string | null;
    failureCount: number;
  }>;
  events: Array<{
    id: number;
    status: string;
    transactionType: string | null;
    direction: string | null;
    channel: string | null;
    amount: number | null;
    balanceAfter: number | null;
    gapAmount: number | null;
    merchant: string | null;
    counterparty: string | null;
    fromAccount: string | null;
    toAccount: string | null;
    receivedAt: number;
    categoryId: number | null;
    commitmentId: number | null;
    transactionId: number | null;
  }>;
};

type BankAnalysis = {
  days: number;
  financial: {
    totalIn: number;
    totalOut: number;
    netFlow: number;
    transactionCount: number;
    latestBalance: number | null;
    byChannel: Array<{ label: string; total: number; count: number }>;
    gaps: Array<{ id: number; receivedAt: number; difference: number; direction: string }>;
    gapTotal: number;
  };
  personal: {
    discretionarySpend: number;
    committedSpend: number;
    discretionaryShare: number;
    averageSpend: number;
    largestSpend: { amount: number; merchant: string | null; receivedAt: number } | null;
    topCounterparties: Array<{ label: string; total: number; count: number }>;
    topCategories: Array<{ label: string; total: number; count: number }>;
    peakHour: number | null;
    peakWeekday: string | null;
  };
};

function formatDate(timestamp: number | null) {
  if (!timestamp) return "لم تتم المزامنة بعد";
  return new Intl.DateTimeFormat("ar-OM", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp * 1000));
}

type InboxEvent = BankInboxData["events"][number];

// Older rows were stored before direction tracking existed, so fall back to the
// income/expense type we did record for them.
function isCredit(event: Pick<InboxEvent, "direction" | "transactionType">) {
  return (event.direction ?? (event.transactionType === "income" ? "credit" : "debit")) === "credit";
}

const CHANNEL_LABELS: Record<string, string> = {
  pos: "شراء بالبطاقة",
  atm: "سحب نقدي",
  transfer: "تحويل",
  bill: "فواتير",
  salary: "راتب",
  online: "شراء إلكتروني",
  fee: "رسوم وعمولات",
  other: "أخرى",
};

function RouteLine({ event }: { event: InboxEvent }) {
  const credit = isCredit(event);
  const from = event.fromAccount || (credit ? event.counterparty || "جهة خارجية" : "حسابك");
  const to = event.toAccount || (credit ? "حسابك" : event.counterparty || "جهة خارجية");

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <span className={`rounded-full px-2 py-0.5 font-semibold ${credit ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
        {credit ? "إيداع" : "خصم"}
      </span>
      {event.channel ? <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{CHANNEL_LABELS[event.channel] || event.channel}</span> : null}
      <span className="flex items-center gap-1 text-muted-foreground">
        <span className="font-medium text-foreground">{from}</span>
        <ArrowLeft className="h-3 w-3 shrink-0" />
        <span className="font-medium text-foreground">{to}</span>
      </span>
      {typeof event.balanceAfter === "number" ? (
        <span className="text-muted-foreground">الرصيد بعدها <CurrencyDisplay amount={event.balanceAfter} fractionDigits={3} /></span>
      ) : null}
      {typeof event.gapAmount === "number" && Math.abs(event.gapAmount) >= 0.001 ? (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
          فجوة {event.gapAmount > 0 ? "إيداع" : "خصم"} <CurrencyDisplay amount={Math.abs(event.gapAmount)} fractionDigits={3} /> برسالة لم تصل
        </span>
      ) : null}
    </div>
  );
}

export default function BankInbox() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<BankInboxData>({ queryKey: ["/api/bank-inbox"] });
  const { data: analysis } = useQuery<BankAnalysis>({ queryKey: ["/api/bank-inbox/analysis"] });
  const { data: wallets = [] } = useWallets();
  const { data: categories = [] } = useCategories();
  const { data: commitments = [] } = useCommitments();
  const [bankKey, setBankKey] = useState("bank_muscat");
  const [customSenders, setCustomSenders] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [editingConnectionId, setEditingConnectionId] = useState<number | null>(null);
  const [accountDraft, setAccountDraft] = useState("");
  const [observedAccounts, setObservedAccounts] = useState<string[]>([]);
  const [walletId, setWalletId] = useState("");
  const [autoImport, setAutoImport] = useState(true);
  const [showSetup, setShowSetup] = useState(false);
  const [pendingDisconnect, setPendingDisconnect] = useState<{ id: number; email: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "1") {
      const provider = params.get("provider");
      toast({ title: provider === "microsoft" ? "تم ربط Outlook" : "تم ربط Gmail", description: "يمكنك الآن قراءة رسائل البنك بضغطة واحدة." });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-inbox"] });
      window.history.replaceState({}, "", "/bank-inbox");
    } else if (params.get("error")) {
      toast({ title: "تعذر ربط Gmail", description: "أعد المحاولة أو راجع إعدادات الربط.", variant: "destructive" });
      window.history.replaceState({}, "", "/bank-inbox");
    }
  }, [toast]);

  useEffect(() => {
    if (!walletId && wallets[0]) setWalletId(String(wallets[0].id));
  }, [walletId, wallets]);

  const bankNames = useMemo(() => new Map((data?.banks || []).map((bank) => [bank.key, bank.name])), [data?.banks]);
  const banksNeedingSender = useMemo(
    () => new Set((data?.banks || []).filter((bank) => bank.requiresCustomSender).map((bank) => bank.key)),
    [data?.banks],
  );
  const walletNames = useMemo(() => new Map(wallets.map((wallet) => [wallet.id, wallet.name])), [wallets]);
  const categoryNames = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories]);
  const commitmentNames = useMemo(() => new Map(commitments.map((commitment) => [commitment.id, commitment.title])), [commitments]);

  const selectedBank = useMemo(() => (data?.banks || []).find((bank) => bank.key === bankKey), [data?.banks, bankKey]);
  const needsCustomSender = Boolean(selectedBank?.requiresCustomSender);
  const hasCustomSender = customSenders.trim().length > 0;
  const isSetupIncomplete = !walletId || (needsCustomSender && !hasCustomSender);

  const connectGoogle = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/bank-inbox/google/start", { bankKey, customSenders, accountFilter, walletId: Number(walletId), autoImport });
      return response.json() as Promise<{ authUrl: string }>;
    },
    onSuccess: ({ authUrl }) => window.location.assign(authUrl),
    onError: (error: Error) => toast({ title: "تعذر بدء الربط", description: error.message, variant: "destructive" }),
  });

  const connectMicrosoft = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/bank-inbox/microsoft/start", { bankKey, customSenders, accountFilter, walletId: Number(walletId), autoImport });
      return response.json() as Promise<{ authUrl: string }>;
    },
    onSuccess: ({ authUrl }) => window.location.assign(authUrl),
    onError: (error: Error) => toast({ title: "تعذر بدء الربط", description: error.message, variant: "destructive" }),
  });
  const syncConnection = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/bank-inbox/connections/${id}/sync`);
      return response.json() as Promise<{
        checked: number; imported: number; review: number; merged: number; duplicate: number;
        otherAccount: number; observedAccounts: string[];
      }>;
    },
    onSuccess: async (summary) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/bank-inbox"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/bank-inbox/analysis"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] }),
      ]);

      setObservedAccounts(summary.observedAccounts || []);

      // Everything filtered out is the case worth explaining — otherwise the
      // screen just says zero and gives the user nothing to act on.
      if (summary.imported === 0 && summary.review === 0 && summary.merged === 0 && summary.otherAccount > 0) {
        toast({
          title: `تخطّينا ${summary.otherAccount} رسالة`,
          description: summary.observedAccounts?.length
            ? `لا تطابق الحساب المحدد. الحسابات الموجودة فعلاً في رسائلك: ${summary.observedAccounts.join("، ")} — اضغط تغيير واختر منها.`
            : "لا تطابق الحساب المحدد، ولم نتعرّف على رقم حساب في أي منها. جرّب متابعة كل الحسابات.",
          variant: "destructive",
        });
        return;
      }

      // A merged message is one the user had already recorded by hand — saying so
      // is what makes it clear we recognised their entry instead of skipping it.
      const parts = [`تمت إضافة ${summary.imported}`];
      if (summary.merged > 0) parts.push(`وطابقنا ${summary.merged} مع حركات سجّلتها بنفسك`);
      if (summary.review > 0) parts.push(`وتحتاج ${summary.review} للمراجعة`);
      if (summary.otherAccount > 0) parts.push(`وتخطّينا ${summary.otherAccount} تخص حسابات أخرى`);

      toast({ title: "اكتملت قراءة البريد", description: `${parts.join("، ")}.` });
    },
    onError: (error: Error) => toast({ title: "تعذرت المزامنة", description: error.message, variant: "destructive" }),
  });

  const updateEvent = useMutation({
    mutationFn: async ({ id, categoryId, commitmentId }: { id: number; categoryId?: number | null; commitmentId?: number | null }) => {
      const response = await apiRequest("PATCH", `/api/bank-inbox/events/${id}`, { categoryId, commitmentId });
      return response.json() as Promise<{ ruleSaved: boolean; ruleLabel: string | null; appliedToPending: number }>;
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/bank-inbox"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/bank-inbox/analysis"] }),
      ]);
      if (result.ruleSaved && result.ruleLabel) {
        toast({
          title: "حفظنا هذا التصنيف",
          description: result.appliedToPending > 0
            ? `سنستخدمه تلقائياً لـ ${result.ruleLabel} مستقبلاً، وطبّقناه على ${result.appliedToPending} حركة معلقة من نفس الجهة.`
            : `سنستخدمه تلقائياً لكل حركة قادمة من ${result.ruleLabel}.`,
        });
      }
    },
    onError: (error: Error) => toast({ title: "تعذر حفظ الاختيار", description: error.message, variant: "destructive" }),
  });
  const importEvent = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/bank-inbox/events/${id}/import`),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/bank-inbox"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/bank-inbox/analysis"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] }),
      ]);
      toast({ title: "تمت إضافة المعاملة" });
    },
    onError: (error: Error) => toast({ title: "تعذرت الإضافة", description: error.message, variant: "destructive" }),
  });

  // `purge` is always sent explicitly: the user is asked before either answer is
  // acted on, because keeping a real spending record and erasing it are both
  // reasonable and neither can be assumed.
  const disconnect = useMutation({
    mutationFn: async ({ id, purge }: { id: number; purge: boolean }) => {
      const response = await apiRequest("DELETE", `/api/bank-inbox/connections/${id}`, { purge });
      return response.json() as Promise<{ message: string; removedTransactions: number }>;
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/bank-inbox"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/wallets"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] }),
      ]);
      setPendingDisconnect(null);
      toast({
        title: result.message,
        description: result.removedTransactions > 0
          ? `حُذفت ${result.removedTransactions} حركة وأُعيدت الأرصدة كما كانت.`
          : undefined,
      });
    },
    onError: (error: Error) => toast({ title: "تعذر فصل البريد", description: error.message, variant: "destructive" }),
  });

  const purgeOrphaned = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/bank-inbox/imports/purge");
      return response.json() as Promise<{ removedTransactions: number; removedEvents: number }>;
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/bank-inbox"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/wallets"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] }),
      ]);
      toast({ title: "تم التنظيف", description: `حُذفت ${result.removedTransactions} حركة وأُعيدت الأرصدة كما كانت.` });
    },
    onError: (error: Error) => toast({ title: "تعذر الحذف", description: error.message, variant: "destructive" }),
  });

  const purgeAdjustments = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/bank-inbox/adjustments/purge");
      return response.json() as Promise<{ message: string; removed: number; walletsSettled: number }>;
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/bank-inbox"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/wallets"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] }),
      ]);
      toast({
        title: "تم التنظيف",
        description: result.walletsSettled > 0
          ? `${result.message}، وضُبط رصيد ${result.walletsSettled} محفظة على آخر رصيد ذكره البنك.`
          : result.message,
      });
    },
    onError: (error: Error) => toast({ title: "تعذر الحذف", description: error.message, variant: "destructive" }),
  });

  const updateConnection = useMutation({
    mutationFn: async ({ id, accountFilter: nextFilter }: { id: number; accountFilter: string; resync?: boolean }) => {
      const response = await apiRequest("PATCH", `/api/bank-inbox/connections/${id}`, { accountFilter: nextFilter });
      return response.json() as Promise<{ id: number; accountFilter: string | null }>;
    },
    onSuccess: async (saved, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/bank-inbox"] });
      setEditingConnectionId(null);
      toast({
        title: saved.accountFilter ? `تم تحديد الحساب ${saved.accountFilter}` : "تمت متابعة كل الحسابات",
        description: variables.resync
          ? "نقرأ الرسائل الآن بهذا الحساب…"
          : "اضغط قراءة الرسائل لإعادة البناء على هذا الحساب.",
      });
      // Reading straight away is the whole point of choosing an account, and it
      // saves the user a third click that is easy to forget.
      if (variables.resync) syncConnection.mutate(variables.id);
    },
    onError: (error: Error) => toast({ title: "تعذر الحفظ", description: error.message, variant: "destructive" }),
  });

  const resetConnection = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/bank-inbox/connections/${id}/reset`);
      return response.json() as Promise<{ removedEvents: number; removedTransactions: number }>;
    },
    onSuccess: async (summary) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/bank-inbox"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/bank-inbox/analysis"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/wallets"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] }),
      ]);
      toast({
        title: "تم حذف الحركات القديمة",
        description: `حُذفت ${summary.removedTransactions} معاملة و${summary.removedEvents} رسالة. اضغط قراءة الرسائل لإعادة قراءتها بالمنطق الجديد.`,
      });
    },
    onError: (error: Error) => toast({ title: "تعذر الحذف", description: error.message, variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }

  const hasConnections = (data?.connections.length || 0) > 0;
  const pendingEvents = (data?.events || []).filter((event) => event.status === "review");

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 pb-24 sm:p-6" dir="rtl">
      {pendingDisconnect ? (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setPendingDisconnect(null)} aria-hidden="true" />
          <div className="fixed inset-x-0 bottom-0 z-50 sm:inset-0 sm:flex sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-labelledby="disconnect-title">
            <div className="mx-auto w-full max-w-md rounded-t-3xl border bg-background p-5 shadow-2xl sm:rounded-3xl">
              <h2 id="disconnect-title" className="text-lg font-bold">فصل {pendingDisconnect.email}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                ماذا نفعل بالحركات التي أضافها هذا الربط؟ هي مصروفات حقيقية حصلت فعلاً، فاختر بوضوح.
              </p>

              <div className="mt-4 space-y-2">
                <Button
                  variant="outline"
                  className="h-auto w-full justify-start whitespace-normal py-3 text-right"
                  disabled={disconnect.isPending}
                  onClick={() => disconnect.mutate({ id: pendingDisconnect.id, purge: false })}
                >
                  <div>
                    <p className="font-semibold">احتفظ بالحركات</p>
                    <p className="mt-1 text-xs font-normal leading-5 text-muted-foreground">
                      تبقى في سجلك كحركات عادية. يمكنك حذفها لاحقاً، ولن تتكرر إذا أعدت الربط.
                    </p>
                  </div>
                </Button>

                <Button
                  variant="outline"
                  className="h-auto w-full justify-start whitespace-normal border-red-200 py-3 text-right hover:bg-red-50"
                  disabled={disconnect.isPending}
                  onClick={() => disconnect.mutate({ id: pendingDisconnect.id, purge: true })}
                >
                  <div>
                    <p className="font-semibold text-red-700">احذفها وابدأ من جديد</p>
                    <p className="mt-1 text-xs font-normal leading-5 text-muted-foreground">
                      تُحذف كل حركة أضافها هذا الربط وتعود أرصدة المحافظ كما كانت. لا يمكن التراجع.
                    </p>
                  </div>
                </Button>
              </div>

              <Button variant="ghost" className="mt-2 w-full" onClick={() => setPendingDisconnect(null)} disabled={disconnect.isPending}>
                إلغاء
              </Button>
              {disconnect.isPending ? (
                <p className="mt-2 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> جارٍ التنفيذ…
                </p>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      <header className="flex items-center gap-3 py-2">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/settings")} aria-label="العودة إلى الإعدادات"><ArrowRight className="h-5 w-5" /></Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">رسائل البنك</h1>
          <p className="mt-1 text-sm text-muted-foreground">نقرأ إشعار البنك ونحوّله إلى معاملة واضحة.</p>
        </div>
        {hasConnections ? <Button variant="outline" size="sm" onClick={() => setShowSetup((value) => !value)}>{showSetup ? "إلغاء" : "ربط بنك آخر"}</Button> : null}
      </header>

      {/* Reachable even with no connections left — that is the whole point of it. */}
      {(data?.orphanedImports.transactions ?? 0) > 0 ? (
        <Card className="border-amber-200 bg-amber-50/60 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <h2 className="font-bold text-amber-900">حركات من ربط محذوف</h2>
              <p className="mt-1 text-sm leading-6 text-amber-900">
                لا يزال في سجلك {data!.orphanedImports.transactions} حركة أضافها ربط بريد فصلته سابقاً واحتفظت بحركاته.
                يمكنك حذفها الآن وستعود أرصدة المحافظ كما كانت.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 border-red-200 text-red-700 hover:bg-red-50"
                disabled={purgeOrphaned.isPending}
                onClick={() => {
                  if (window.confirm(`سيحذف هذا ${data!.orphanedImports.transactions} حركة ويعيد الأرصدة كما كانت. لا يمكن التراجع. متابعة؟`)) {
                    purgeOrphaned.mutate();
                  }
                }}
              >
                {purgeOrphaned.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                احذفها وأعد الأرصدة
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {/* These were booked when the balance chain was being read across two
          accounts, so most of them describe money that never moved. */}
      {(data?.unknownAdjustments.count ?? 0) > 0 ? (
        <Card className="border-amber-200 bg-amber-50/60 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <h2 className="font-bold text-amber-900">حركات «فرق غير معروف»</h2>
              <p className="mt-1 text-sm leading-6 text-amber-900">
                في سجلك {data!.unknownAdjustments.count} حركة بعنوان «فرق غير معروف · مجهول» بمجموع{" "}
                {formatCurrency(data!.unknownAdjustments.total)}. كانت تُسجَّل عندما يقرأ النظام أرصدة حسابين مختلفين
                على أنها حساب واحد، فتظهر فروق كبيرة لا تقابل أي حركة حقيقية. حذفها يُعيد ضبط رصيد المحفظة على
                آخر رصيد ذكره البنك نفسه.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 border-red-200 text-red-700 hover:bg-red-50"
                disabled={purgeAdjustments.isPending}
                onClick={() => {
                  if (window.confirm(`سيحذف هذا ${data!.unknownAdjustments.count} حركة «فرق غير معروف» ويضبط الرصيد على آخر رصيد ذكره البنك. لا يمكن التراجع. متابعة؟`)) {
                    purgeAdjustments.mutate();
                  }
                }}
              >
                {purgeAdjustments.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                احذفها واضبط الرصيد
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {!hasConnections || showSetup ? (
        <Card className="overflow-hidden border-primary/15 shadow-sm">
          <div className="bg-primary/5 p-5 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><Mail className="h-7 w-7" /></div>
            <h2 className="mt-4 text-xl font-bold">اربط بريدك في خطوة واحدة</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">اختر البنك والمحفظة فقط. التزام سيبحث عن رسائل البنك دون قراءة رسائلك الشخصية أو تعديلها.</p>
          </div>
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm font-semibold">
                <span>اسم البنك</span>
                <select value={bankKey} onChange={(event) => setBankKey(event.target.value)} className="h-11 w-full rounded-xl border bg-background px-3 font-normal">
                  {(data?.banks || []).map((bank) => <option key={bank.key} value={bank.key}>{bank.name}</option>)}
                </select>
              </label>
              <label className="space-y-2 text-sm font-semibold">
                <span>تُضاف المعاملات إلى</span>
                <select value={walletId} onChange={(event) => setWalletId(event.target.value)} className="h-11 w-full rounded-xl border bg-background px-3 font-normal">
                  {wallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}
                </select>
              </label>
            </div>

            {needsCustomSender ? (
              <label className="space-y-2 text-sm font-semibold">
                <span>عنوان مرسل إشعارات البنك</span>
                <input
                  value={customSenders}
                  onChange={(event) => setCustomSenders(event.target.value)}
                  placeholder="alerts@yourbank.com"
                  dir="ltr"
                  className="h-11 w-full rounded-xl border bg-background px-3 font-normal"
                />
                <span className="block text-xs font-normal leading-5 text-muted-foreground">
                  افتح رسالة من بنكك وانسخ عنوان المرسل. نقرأ الرسائل الواردة من هذا العنوان فقط، وباقي بريدك لا يُقرأ إطلاقًا. يمكنك إضافة أكثر من عنوان بينها فاصلة.
                </span>
              </label>
            ) : null}

            <label className="space-y-2 text-sm font-semibold">
              <span>رقم الحساب المراد متابعته <span className="font-normal text-muted-foreground">(اختياري)</span></span>
              <input
                value={accountFilter}
                onChange={(event) => setAccountFilter(event.target.value)}
                placeholder="آخر 4 أرقام، مثل 1234"
                dir="ltr"
                inputMode="numeric"
                className="h-11 w-full rounded-xl border bg-background px-3 font-normal"
              />
              <span className="block text-xs font-normal leading-5 text-muted-foreground">
                لديك أكثر من حساب في نفس البنك؟ حدّد آخر أربعة أرقام للحساب الذي تريد متابعته، فنقرأ رسائله وحده. اتركه فارغاً لمتابعة كل الحسابات معاً.
              </span>
            </label>

            {wallets.length === 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                أضف حساب البنك أولًا، ثم ارجع للربط.
                <Button variant="link" className="h-auto px-2 text-amber-900" onClick={() => setLocation("/wallets")}>إضافة حساب</Button>
              </div>
            ) : null}

            <div className="flex items-center justify-between rounded-xl border p-3">
              <div>
                <p className="font-semibold">إضافة تلقائية</p>
                <p className="mt-1 text-xs text-muted-foreground">المعاملات الواضحة تُضاف فورًا، وغير الواضحة تنتظر موافقتك.</p>
              </div>
              <Switch checked={autoImport} onCheckedChange={setAutoImport} />
            </div>

            <Button className="h-12 w-full text-base font-bold" disabled={isSetupIncomplete || connectGoogle.isPending || !data?.providers.google.configured} onClick={() => connectGoogle.mutate()}>
              {connectGoogle.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mail className="h-5 w-5" />}
              ربط Gmail
            </Button>
            {!data?.providers.google.configured ? <p className="text-center text-xs text-amber-700">ربط Gmail متاح بعد تفعيل خدمة البريد من إدارة المنصة.</p> : null}

            <Button variant="outline" className="h-12 w-full text-base font-bold" disabled={isSetupIncomplete || connectMicrosoft.isPending || !data?.providers.microsoft.configured} onClick={() => connectMicrosoft.mutate()}>
              {connectMicrosoft.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Inbox className="h-5 w-5" />}
              ربط Outlook
            </Button>
            {!data?.providers.microsoft.configured ? <p className="text-center text-xs text-amber-700">ربط Outlook متاح بعد تفعيل خدمة البريد من إدارة المنصة.</p> : null}
          </div>
        </Card>
      ) : (
        <>
          <Card className="p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><CheckCircle2 className="h-5 w-5" /></div>
              <div><h2 className="font-bold">البريد مرتبط</h2><p className="text-sm text-muted-foreground">اضغط قراءة الرسائل متى أردت تحديث المعاملات.</p></div>
            </div>
            <div className="space-y-3">
              {data?.connections.map((connection) => {
                const missingSender = banksNeedingSender.has(connection.bankKey) && !connection.customSenders;

                const importedAccounts = (data?.detectedAccounts || []).filter((account) => account.connectionId === connection.id);
                // Accounts seen during the last sync count too, including ones the
                // current filter rejected — those are exactly what the user needs.
                const connectionAccounts = [
                  ...importedAccounts,
                  ...observedAccounts
                    .filter((reference) => !importedAccounts.some((account) => account.accountRef === reference))
                    .map((reference) => ({ accountRef: reference, connectionId: connection.id, count: 0 })),
                ];
                const isEditing = editingConnectionId === connection.id;

                return (
                  <div key={connection.id} className="rounded-xl border p-3">
                   <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Mail className="h-5 w-5 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <p className="truncate font-semibold" dir="ltr">{connection.email}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{bankNames.get(connection.bankKey)} · {walletNames.get(connection.walletId)} · {formatDate(connection.lastSyncAt)}</p>
                        <p className="mt-1 text-xs">
                          {connection.accountFilter ? (
                            <span className="text-emerald-700">يتابع الحساب المنتهي بـ <span dir="ltr">{connection.accountFilter}</span> فقط</span>
                          ) : (
                            <span className="text-amber-700">يتابع كل حسابات هذا البنك — قد تختلط أرصدتها</span>
                          )}
                          <button
                            type="button"
                            className="mr-2 underline"
                            onClick={() => {
                              setEditingConnectionId(isEditing ? null : connection.id);
                              setAccountDraft(connection.accountFilter || "");
                            }}
                          >
                            {isEditing ? "إلغاء" : "تغيير"}
                          </button>
                        </p>
                        {missingSender ? (
                          <p className="mt-1 text-xs text-amber-700">هذا الربط ينقصه عنوان مرسل البنك. افصله ثم أعد ربطه لتحديد العنوان.</p>
                        ) : null}
                        {connection.lastStatus === "error" && connection.lastError ? (
                          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 p-2 text-xs leading-5 text-red-800">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>
                              توقفت القراءة التلقائية: {connection.lastError}
                              {connection.failureCount > 1 ? ` (تكررت ${connection.failureCount} مرات)` : ""}
                            </span>
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button className="flex-1 sm:flex-none" onClick={() => syncConnection.mutate(connection.id)} disabled={syncConnection.isPending || missingSender}>
                        {syncConnection.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} قراءة الرسائل
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="حذف الحركات المستوردة وإعادة القراءة"
                        title="حذف الحركات المستوردة وإعادة القراءة"
                        disabled={resetConnection.isPending}
                        onClick={() => {
                          if (window.confirm("سيحذف هذا كل الحركات التي استوردها هذا الربط ويعيد الأرصدة كما كانت، ثم تقرأ الرسائل من جديد بالمنطق المصحّح. متابعة؟")) {
                            resetConnection.mutate(connection.id);
                          }
                        }}
                      >
                        {resetConnection.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                      <Button variant="outline" size="icon" aria-label="فصل البريد" onClick={() => setPendingDisconnect({ id: connection.id, email: connection.email })}><Unplug className="h-4 w-4" /></Button>
                    </div>
                   </div>

                   {isEditing ? (
                     <div className="mt-3 space-y-3 rounded-xl bg-muted/40 p-3">
                       <label className="block space-y-2 text-sm font-semibold">
                         <span>الحساب الذي تريد متابعته</span>
                         <input
                           value={accountDraft}
                           onChange={(event) => setAccountDraft(event.target.value)}
                           placeholder="آخر 4 أرقام، مثل 1234"
                           dir="ltr"
                           inputMode="numeric"
                           className="h-11 w-full rounded-xl border bg-background px-3 font-normal"
                         />
                       </label>

                       {connectionAccounts.length > 0 ? (
                         <div className="space-y-2">
                           <p className="text-xs text-muted-foreground">حسابات ظهرت في رسائلك — اضغط أحدها ليُحفظ وتُقرأ رسائله فوراً:</p>
                           <div className="flex flex-wrap gap-2">
                             {connectionAccounts.map((account) => (
                               <button
                                 key={account.accountRef}
                                 type="button"
                                 disabled={updateConnection.isPending}
                                 onClick={() => {
                                   setAccountDraft(account.accountRef);
                                   updateConnection.mutate({ id: connection.id, accountFilter: account.accountRef, resync: true });
                                 }}
                                 className={`rounded-full border px-3 py-1 text-xs ${accountDraft === account.accountRef ? "border-primary bg-primary/10 font-semibold text-primary" : "bg-background"}`}
                               >
                                 <span dir="ltr">{account.accountRef}</span>{account.count > 0 ? ` · ${account.count} رسالة` : ""}
                               </button>
                             ))}
                           </div>
                         </div>
                       ) : (
                         <p className="text-xs text-muted-foreground">اضغط «قراءة الرسائل» أولاً — سنعرض لك عندها أرقام الحسابات الموجودة في بريدك لتختار منها.</p>
                       )}

                       <div className="flex gap-2">
                         <Button
                           onClick={() => updateConnection.mutate({ id: connection.id, accountFilter: accountDraft, resync: true })}
                           disabled={updateConnection.isPending}
                         >
                           {updateConnection.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ وقراءة"}
                         </Button>
                         <Button variant="outline" onClick={() => updateConnection.mutate({ id: connection.id, accountFilter: "", resync: true })} disabled={updateConnection.isPending}>
                           متابعة كل الحسابات
                         </Button>
                       </div>
                     </div>
                   ) : null}
                  </div>
                );
              })}
            </div>
          </Card>

          {pendingEvents.length > 0 ? (
            <Card className="p-4 shadow-sm">
              <div className="mb-4 flex items-center gap-3"><Sparkles className="h-5 w-5 text-amber-600" /><div><h2 className="font-bold">تحتاج تأكيدك</h2><p className="text-sm text-muted-foreground">لم نضف هذه الحركات حتى تراجعها.</p></div></div>
              <div className="space-y-3">
                {pendingEvents.map((event) => (
                  <div key={event.id} className="rounded-xl border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><p className="truncate font-semibold">{event.merchant || "معاملة بنكية"}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(event.receivedAt)}{event.categoryId ? ` · ${categoryNames.get(event.categoryId)}` : ""}{event.commitmentId ? ` · مرتبط بـ ${commitmentNames.get(event.commitmentId)}` : ""}</p></div>
                      <span className={isCredit(event) ? "font-bold text-emerald-600" : "font-bold text-red-600"}>{isCredit(event) ? "+" : "-"}<CurrencyDisplay amount={event.amount || 0} fractionDigits={3} /></span>
                    </div>
                    <RouteLine event={event} />
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <select
                        aria-label="تصنيف المعاملة"
                        value={event.categoryId || ""}
                        onChange={(change) => updateEvent.mutate({ id: event.id, categoryId: change.target.value ? Number(change.target.value) : null })}
                        className="h-10 rounded-xl border bg-background px-3 text-sm"
                      >
                        <option value="">بدون تصنيف</option>
                        {categories.filter((category) => category.type === event.transactionType).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                      </select>
                      <select
                        aria-label="ربط بالتزام"
                        value={event.commitmentId || ""}
                        onChange={(change) => updateEvent.mutate({ id: event.id, commitmentId: change.target.value ? Number(change.target.value) : null })}
                        className="h-10 rounded-xl border bg-background px-3 text-sm"
                      >
                        <option value="">بدون التزام مرتبط</option>
                        {commitments.filter((commitment) => commitment.type === "financial" && commitment.status === "active").map((commitment) => <option key={commitment.id} value={commitment.id}>{commitment.title}</option>)}
                      </select>
                    </div>
                    <Button variant="outline" className="mt-2 w-full" onClick={() => importEvent.mutate(event.id)} disabled={importEvent.isPending}>إضافة المعاملة</Button>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </>
      )}

      {hasConnections && analysis && analysis.financial.transactionCount > 0 ? (
        <>
          <Card className="p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700"><Wallet className="h-5 w-5" /></div>
              <div>
                <h2 className="font-bold">التحليل المالي</h2>
                <p className="text-sm text-muted-foreground">آخر {analysis.days} يوماً · {analysis.financial.transactionCount} حركة</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-emerald-50 p-3">
                <p className="text-xs text-emerald-800">إجمالي الوارد</p>
                <p className="mt-1 font-bold text-emerald-700"><CurrencyDisplay amount={analysis.financial.totalIn} fractionDigits={3} /></p>
              </div>
              <div className="rounded-xl bg-red-50 p-3">
                <p className="text-xs text-red-800">إجمالي الصادر</p>
                <p className="mt-1 font-bold text-red-700"><CurrencyDisplay amount={analysis.financial.totalOut} fractionDigits={3} /></p>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">صافي التدفق</p>
                <p className={`mt-1 font-bold ${analysis.financial.netFlow >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                  <CurrencyDisplay amount={analysis.financial.netFlow} fractionDigits={3} />
                </p>
              </div>
            </div>

            {analysis.financial.byChannel.length > 0 ? (
              <div className="mt-4 space-y-2">
                <p className="text-sm font-semibold">التوزيع حسب نوع العملية</p>
                {analysis.financial.byChannel.map((channel) => (
                  <div key={channel.label} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
                    <span>{channel.label} <span className="text-xs text-muted-foreground">({channel.count})</span></span>
                    <CurrencyDisplay amount={channel.total} fractionDigits={3} />
                  </div>
                ))}
              </div>
            ) : null}

            {analysis.financial.gaps.length > 0 ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-center gap-2 font-semibold text-amber-900">
                  <AlertTriangle className="h-4 w-4" />
                  {analysis.financial.gaps.length} فجوة في الرصيد
                </div>
                <p className="mt-1 text-xs leading-5 text-amber-900">
                  قارنّا الرصيد المذكور في كل رسالة بالرصيد المتوقع من الرسالة التي قبلها. الفرق يعني حركات حصلت ولم تصلك رسالة بها.
                  صافي الفرق <CurrencyDisplay amount={analysis.financial.gapTotal} fractionDigits={3} />
                </p>
                <div className="mt-2 space-y-1">
                  {analysis.financial.gaps.slice(0, 4).map((gap) => (
                    <div key={gap.id} className="flex items-center justify-between text-xs text-amber-900">
                      <span>{formatDate(gap.receivedAt)}</span>
                      <span className="font-semibold">{gap.direction === "credit" ? "إيداع" : "خصم"} <CurrencyDisplay amount={Math.abs(gap.difference)} fractionDigits={3} /></span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>

          <Card className="p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Sparkles className="h-5 w-5" /></div>
              <div>
                <h2 className="font-bold">التحليل الشخصي</h2>
                <p className="text-sm text-muted-foreground">كيف تنفق فعلياً، لا كم أنفقت فقط.</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">إنفاق اختياري</p>
                <p className="mt-1 font-bold"><CurrencyDisplay amount={analysis.personal.discretionarySpend} fractionDigits={3} /></p>
                <p className="mt-1 text-xs text-muted-foreground">{analysis.personal.discretionaryShare}% من صرفك — شراء وسحب نقدي</p>
              </div>
              <div className="rounded-xl bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">إنفاق ملتزم به</p>
                <p className="mt-1 font-bold"><CurrencyDisplay amount={analysis.personal.committedSpend} fractionDigits={3} /></p>
                <p className="mt-1 text-xs text-muted-foreground">فواتير ورسوم وتحويلات</p>
              </div>
              <div className="rounded-xl bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">متوسط العملية</p>
                <p className="mt-1 font-bold"><CurrencyDisplay amount={analysis.personal.averageSpend} fractionDigits={3} /></p>
              </div>
              {analysis.personal.largestSpend ? (
                <div className="rounded-xl bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">أكبر عملية</p>
                  <p className="mt-1 font-bold"><CurrencyDisplay amount={analysis.personal.largestSpend.amount} fractionDigits={3} /></p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{analysis.personal.largestSpend.merchant || "غير محدد"}</p>
                </div>
              ) : null}
            </div>

            {analysis.personal.topCounterparties.length > 0 ? (
              <div className="mt-4 space-y-2">
                <p className="text-sm font-semibold">أكثر الجهات التي تصرف عندها</p>
                {analysis.personal.topCounterparties.map((party) => (
                  <div key={party.label} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
                    <span className="truncate">{party.label} <span className="text-xs text-muted-foreground">({party.count} مرة)</span></span>
                    <CurrencyDisplay amount={party.total} fractionDigits={3} />
                  </div>
                ))}
              </div>
            ) : null}

            {analysis.personal.peakWeekday || analysis.personal.peakHour !== null ? (
              <p className="mt-4 rounded-xl bg-violet-50 p-3 text-sm leading-6 text-violet-900">
                أكثر صرفك يقع
                {analysis.personal.peakWeekday ? ` يوم ${analysis.personal.peakWeekday}` : ""}
                {analysis.personal.peakHour !== null ? ` حول الساعة ${analysis.personal.peakHour}:00` : ""}.
              </p>
            ) : null}
          </Card>
        </>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3 text-sm"><ShieldCheck className="h-5 w-5 text-emerald-600" /><span>قراءة فقط</span></div>
        <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3 text-sm"><RefreshCw className="h-5 w-5 text-blue-600" /><span>منع التكرار</span></div>
        <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3 text-sm"><Building2 className="h-5 w-5 text-violet-600" /><span>تصنيف ذكي</span></div>
      </div>
    </div>
  );
}