import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, CheckCircle2, ChevronDown, Loader2, Mail, RefreshCw, ShieldCheck, Sparkles, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCategories, useCommitments, useWallets } from "@/lib/hooks";
import { CurrencyDisplay } from "@/components/ui/currency-display";
import { EmailProviderButtons, type EmailProvider } from "@/components/email-provider-buttons";

 type BankInboxData = {
  providers: {
    google: { configured: boolean };
    microsoft: { configured: boolean };
  };
  banks: Array<{ key: string; name: string }>;
  connections: Array<{
    id: number;
    provider: string;
    email: string;
    bankKey: string;
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
  const [bankKey, setBankKey] = useState("other");
  const [walletId, setWalletId] = useState("");
  const [autoImport, setAutoImport] = useState(true);
  const [showSetup, setShowSetup] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);

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
  const walletNames = useMemo(() => new Map(wallets.map((wallet) => [wallet.id, wallet.name])), [wallets]);
  const categoryNames = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories]);
  const commitmentNames = useMemo(() => new Map(commitments.map((commitment) => [commitment.id, commitment.title])), [commitments]);

  const connectGoogle = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/bank-inbox/google/start", { bankKey, walletId: walletId ? Number(walletId) : undefined, autoImport });
      return response.json() as Promise<{ authUrl: string }>;
    },
    onSuccess: ({ authUrl }) => window.location.assign(authUrl),
    onError: (error: Error) => toast({ title: "تعذر بدء الربط", description: error.message, variant: "destructive" }),
  });

  const connectMicrosoft = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/bank-inbox/microsoft/start", { bankKey, walletId: walletId ? Number(walletId) : undefined, autoImport });
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
  const pendingProvider: EmailProvider | null = connectGoogle.isPending
    ? "google"
    : connectMicrosoft.isPending
      ? "microsoft"
      : null;
  const selectProvider = (provider: EmailProvider) =>
    provider === "google" ? connectGoogle.mutate() : connectMicrosoft.mutate();

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
        <Card className="mx-auto max-w-xl overflow-hidden border-border/80 shadow-sm">
          <div className="px-5 pb-4 pt-7 text-center sm:px-8">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Mail className="h-7 w-7" /></div>
            <h2 className="mt-4 text-xl font-bold">اربط بريد البنك</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">اختر حساب البريد الذي تصلك عليه رسائل البنك، وسيتولى التزام الإعداد تلقائيًا.</p>
          </div>
          <div className="space-y-3 px-5 pb-6 sm:px-8 sm:pb-8">
            <EmailProviderButtons
              onSelect={selectProvider}
              pendingProvider={pendingProvider}
              googleDisabled={!data?.providers.google.configured}
              microsoftDisabled={!data?.providers.microsoft.configured}
            />

            {!data?.providers.google.configured || !data?.providers.microsoft.configured ? (
              <p className="text-center text-xs leading-5 text-amber-700">الخدمة غير المفعّلة ستعمل تلقائيًا فور تهيئتها من إدارة المنصة.</p>
            ) : null}

            <button
              type="button"
              className="mx-auto flex items-center gap-1.5 pt-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setShowPreferences((value) => !value)}
              aria-expanded={showPreferences}
            >
              إعدادات الربط
              <ChevronDown className={`h-4 w-4 transition-transform ${showPreferences ? "rotate-180" : ""}`} />
            </button>

            {showPreferences ? (
              <div className="space-y-4 rounded-2xl bg-muted/40 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-2 text-sm font-semibold">
                    <span>البنك</span>
                    <select value={bankKey} onChange={(event) => setBankKey(event.target.value)} className="h-11 w-full rounded-xl border bg-background px-3 font-normal">
                      {(data?.banks || []).map((bank) => <option key={bank.key} value={bank.key}>{bank.name}</option>)}
                    </select>
                  </label>
                  <label className="space-y-2 text-sm font-semibold">
                    <span>حفظ المعاملات في</span>
                    <select value={walletId} onChange={(event) => setWalletId(event.target.value)} className="h-11 w-full rounded-xl border bg-background px-3 font-normal">
                      {wallets.length === 0 ? <option value="">حساب البنك (يُنشأ تلقائيًا)</option> : null}
                      {wallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}
                    </select>
                  </label>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-xl border bg-background p-3">
                  <div>
                    <p className="font-semibold">إضافة تلقائية</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">المعاملات الواضحة تُضاف فورًا، والباقي ينتظر موافقتك.</p>
                  </div>
                  <Switch checked={autoImport} onCheckedChange={setAutoImport} />
                </div>
              </div>
            ) : null}

            <div className="flex items-center justify-center gap-2 pt-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              نقرأ رسائل البنك فقط ولا نعدّل بريدك
            </div>
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
              {data?.connections.map((connection) => (
                <div key={connection.id} className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Mail className="h-5 w-5 shrink-0 text-primary" />
                    <div className="min-w-0"><p className="truncate font-semibold" dir="ltr">{connection.email}</p><p className="mt-1 text-xs text-muted-foreground">{bankNames.get(connection.bankKey)} · {walletNames.get(connection.walletId)} · {formatDate(connection.lastSyncAt)}</p></div>
                  </div>
                  <div className="flex gap-2">
                    <Button className="flex-1 sm:flex-none" onClick={() => syncConnection.mutate(connection.id)} disabled={syncConnection.isPending}>
                      {syncConnection.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} قراءة الرسائل
                    </Button>
                    <Button variant="outline" size="icon" aria-label="فصل البريد" onClick={() => disconnect.mutate(connection.id)}><Unplug className="h-4 w-4" /></Button>
                  </div>
                </div>
              ))}
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