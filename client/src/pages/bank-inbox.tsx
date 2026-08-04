import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, CheckCircle2, Inbox, Loader2, Mail, RefreshCw, ShieldCheck, Sparkles, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCategories, useCommitments, useWallets } from "@/lib/hooks";
import { CurrencyDisplay } from "@/components/ui/currency-display";

 type BankInboxData = {
  providers: {
    google: { configured: boolean };
    microsoft: { configured: boolean };
  };
  banks: Array<{ key: string; name: string; requiresCustomSender: boolean }>;
  connections: Array<{
    id: number;
    provider: string;
    email: string;
    bankKey: string;
    customSenders: string | null;
    walletId: number;
    autoImport: boolean;
    lastSyncAt: number | null;
  }>;
  events: Array<{
    id: number;
    status: string;
    transactionType: string | null;
    amount: number | null;
    merchant: string | null;
    receivedAt: number;
    categoryId: number | null;
    commitmentId: number | null;
    transactionId: number | null;
  }>;
};

function formatDate(timestamp: number | null) {
  if (!timestamp) return "لم تتم المزامنة بعد";
  return new Intl.DateTimeFormat("ar-OM", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp * 1000));
}

export default function BankInbox() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<BankInboxData>({ queryKey: ["/api/bank-inbox"] });
  const { data: wallets = [] } = useWallets();
  const { data: categories = [] } = useCategories();
  const { data: commitments = [] } = useCommitments();
  const [bankKey, setBankKey] = useState("bank_muscat");
  const [customSenders, setCustomSenders] = useState("");
  const [walletId, setWalletId] = useState("");
  const [autoImport, setAutoImport] = useState(true);
  const [showSetup, setShowSetup] = useState(false);

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
      const response = await apiRequest("POST", "/api/bank-inbox/google/start", { bankKey, customSenders, walletId: Number(walletId), autoImport });
      return response.json() as Promise<{ authUrl: string }>;
    },
    onSuccess: ({ authUrl }) => window.location.assign(authUrl),
    onError: (error: Error) => toast({ title: "تعذر بدء الربط", description: error.message, variant: "destructive" }),
  });

  const connectMicrosoft = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/bank-inbox/microsoft/start", { bankKey, customSenders, walletId: Number(walletId), autoImport });
      return response.json() as Promise<{ authUrl: string }>;
    },
    onSuccess: ({ authUrl }) => window.location.assign(authUrl),
    onError: (error: Error) => toast({ title: "تعذر بدء الربط", description: error.message, variant: "destructive" }),
  });
  const syncConnection = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/bank-inbox/connections/${id}/sync`);
      return response.json() as Promise<{ checked: number; imported: number; review: number; duplicate: number }>;
    },
    onSuccess: async (summary) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/bank-inbox"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] }),
      ]);
      toast({ title: "اكتملت قراءة البريد", description: `تمت إضافة ${summary.imported}، وتحتاج ${summary.review} للمراجعة.` });
    },
    onError: (error: Error) => toast({ title: "تعذرت المزامنة", description: error.message, variant: "destructive" }),
  });

  const updateEvent = useMutation({
    mutationFn: ({ id, categoryId, commitmentId }: { id: number; categoryId?: number | null; commitmentId?: number | null }) =>
      apiRequest("PATCH", `/api/bank-inbox/events/${id}`, { categoryId, commitmentId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/bank-inbox"] }),
    onError: (error: Error) => toast({ title: "تعذر حفظ الاختيار", description: error.message, variant: "destructive" }),
  });
  const importEvent = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/bank-inbox/events/${id}/import`),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/bank-inbox"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] }),
      ]);
      toast({ title: "تمت إضافة المعاملة" });
    },
    onError: (error: Error) => toast({ title: "تعذرت الإضافة", description: error.message, variant: "destructive" }),
  });

  const disconnect = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/bank-inbox/connections/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/bank-inbox"] }),
  });

  if (isLoading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }

  const hasConnections = (data?.connections.length || 0) > 0;
  const pendingEvents = (data?.events || []).filter((event) => event.status === "review");

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 pb-24 sm:p-6" dir="rtl">
      <header className="flex items-center gap-3 py-2">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/settings")} aria-label="العودة إلى الإعدادات"><ArrowRight className="h-5 w-5" /></Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">رسائل البنك</h1>
          <p className="mt-1 text-sm text-muted-foreground">نقرأ إشعار البنك ونحوّله إلى معاملة واضحة.</p>
        </div>
        {hasConnections ? <Button variant="outline" size="sm" onClick={() => setShowSetup((value) => !value)}>{showSetup ? "إلغاء" : "ربط بنك آخر"}</Button> : null}
      </header>

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

                return (
                  <div key={connection.id} className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Mail className="h-5 w-5 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <p className="truncate font-semibold" dir="ltr">{connection.email}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{bankNames.get(connection.bankKey)} · {walletNames.get(connection.walletId)} · {formatDate(connection.lastSyncAt)}</p>
                        {missingSender ? (
                          <p className="mt-1 text-xs text-amber-700">هذا الربط ينقصه عنوان مرسل البنك. افصله ثم أعد ربطه لتحديد العنوان.</p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button className="flex-1 sm:flex-none" onClick={() => syncConnection.mutate(connection.id)} disabled={syncConnection.isPending || missingSender}>
                        {syncConnection.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} قراءة الرسائل
                      </Button>
                      <Button variant="outline" size="icon" aria-label="فصل البريد" onClick={() => disconnect.mutate(connection.id)}><Unplug className="h-4 w-4" /></Button>
                    </div>
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
                      <span className={event.transactionType === "income" ? "font-bold text-emerald-600" : "font-bold text-red-600"}>{event.transactionType === "income" ? "+" : "-"}<CurrencyDisplay amount={event.amount || 0} fractionDigits={3} /></span>
                    </div>
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

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3 text-sm"><ShieldCheck className="h-5 w-5 text-emerald-600" /><span>قراءة فقط</span></div>
        <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3 text-sm"><RefreshCw className="h-5 w-5 text-blue-600" /><span>منع التكرار</span></div>
        <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3 text-sm"><Building2 className="h-5 w-5 text-violet-600" /><span>تصنيف ذكي</span></div>
      </div>
    </div>
  );
}