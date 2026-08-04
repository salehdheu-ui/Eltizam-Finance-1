import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Check, Copy, Loader2, Mail, PlugZap, Trash2 } from "lucide-react";
import {
  useAdminDeleteIntegration,
  useAdminIntegrations,
  useAdminSaveIntegration,
  useAdminTestIntegration,
  type AdminIntegration,
  type AdminIntegrationProvider,
} from "@/lib/hooks";
import { formatDate } from "@/lib/utils";

type DraftState = {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  redirectUri: string;
  isEnabled: boolean;
};

const PROVIDER_GUIDE: Record<AdminIntegrationProvider, { console: string; steps: string[] }> = {
  google: {
    console: "Google Cloud Console › APIs & Services › Credentials",
    steps: [
      "أنشئ OAuth client من نوع Web application.",
      "فعّل Gmail API للمشروع.",
      "أضف رابط إعادة التوجيه أدناه في Authorized redirect URIs.",
    ],
  },
  microsoft: {
    console: "Azure Portal › App registrations",
    steps: [
      "سجّل تطبيقاً جديداً وأنشئ Client secret.",
      "أضف صلاحيات Microsoft Graph المفوّضة: Mail.Read و User.Read و offline_access.",
      "أضف رابط إعادة التوجيه أدناه ضمن Web › Redirect URIs.",
    ],
  },
};

function toDraft(integration: AdminIntegration): DraftState {
  return {
    clientId: integration.clientId || "",
    clientSecret: "",
    tenantId: integration.tenantId || "",
    redirectUri: integration.redirectUri || "",
    isEnabled: integration.isEnabled,
  };
}

function StatusBadge({ integration }: { integration: AdminIntegration }) {
  if (integration.hasDatabaseRecord && !integration.isEnabled) {
    return <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-700">موقوف</span>;
  }

  if (!integration.configured) {
    return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">غير مهيّأ</span>;
  }

  return (
    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs text-emerald-700">
      {integration.source === "database" ? "مفعّل · محفوظ في القاعدة" : "مفعّل · من متغيرات البيئة"}
    </span>
  );
}

function CopyableUri({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-xl bg-muted/40 p-2">
      <code className="min-w-0 flex-1 truncate text-xs" dir="ltr">{value}</code>
      <Button type="button" variant="ghost" size="icon" onClick={handleCopy} aria-label="نسخ رابط إعادة التوجيه">
        {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function IntegrationForm({ integration }: { integration: AdminIntegration }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<DraftState>(() => toDraft(integration));
  const saveMutation = useAdminSaveIntegration();
  const deleteMutation = useAdminDeleteIntegration();
  const testMutation = useAdminTestIntegration();
  const guide = PROVIDER_GUIDE[integration.provider];

  useEffect(() => {
    setDraft(toDraft(integration));
  }, [integration]);

  const isBusy = saveMutation.isPending || deleteMutation.isPending || testMutation.isPending;

  const handleSave = async () => {
    if (!draft.clientId.trim()) {
      toast({ title: "تنبيه", description: "أدخل معرّف التطبيق (Client ID)", variant: "destructive" });
      return;
    }

    if (!integration.hasDatabaseRecord && !draft.clientSecret.trim()) {
      toast({ title: "تنبيه", description: "أدخل المفتاح السري (Client Secret) عند الحفظ لأول مرة", variant: "destructive" });
      return;
    }

    try {
      await saveMutation.mutateAsync({
        provider: integration.provider,
        clientId: draft.clientId.trim(),
        clientSecret: draft.clientSecret.trim() || undefined,
        tenantId: draft.tenantId.trim() || null,
        redirectUri: draft.redirectUri.trim() || null,
        isEnabled: draft.isEnabled,
      });
      setDraft((current) => ({ ...current, clientSecret: "" }));
      toast({ title: "تم الحفظ", description: `تم تحديث مفاتيح ${integration.label}` });
    } catch (error) {
      toast({ title: "خطأ", description: error instanceof Error ? error.message : "تعذر حفظ المفاتيح", variant: "destructive" });
    }
  };

  const handleTest = async () => {
    try {
      const result = await testMutation.mutateAsync(integration.provider);
      toast({
        title: result.ok ? "الاتصال ناجح" : "الاتصال فشل",
        description: result.message,
        variant: result.ok ? undefined : "destructive",
      });
    } catch (error) {
      toast({ title: "خطأ", description: error instanceof Error ? error.message : "تعذر اختبار الاتصال", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`هل تريد حذف مفاتيح ${integration.label} المحفوظة؟ سيعود النظام إلى متغيرات البيئة إن وُجدت.`)) {
      return;
    }

    try {
      await deleteMutation.mutateAsync(integration.provider);
      toast({ title: "تم الحذف", description: "تم حذف المفاتيح المحفوظة" });
    } catch (error) {
      toast({ title: "خطأ", description: error instanceof Error ? error.message : "تعذر حذف المفاتيح", variant: "destructive" });
    }
  };

  return (
    <div className="rounded-xl border border-border/50 p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold">{integration.label}</h3>
          <p className="text-xs text-muted-foreground mt-1">{guide.console}</p>
        </div>
        <StatusBadge integration={integration} />
      </div>

      <ul className="space-y-1 text-xs text-muted-foreground leading-6">
        {guide.steps.map((step) => <li key={step}>• {step}</li>)}
      </ul>

      <div className="space-y-2">
        <Label className="text-sm">رابط إعادة التوجيه المطلوب تسجيله</Label>
        <CopyableUri value={integration.effectiveRedirectUri} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${integration.provider}-client-id`} className="text-sm">Client ID</Label>
          <Input
            id={`${integration.provider}-client-id`}
            value={draft.clientId}
            onChange={(event) => setDraft((current) => ({ ...current, clientId: event.target.value }))}
            placeholder="معرّف التطبيق"
            dir="ltr"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${integration.provider}-client-secret`} className="text-sm">Client Secret</Label>
          <Input
            id={`${integration.provider}-client-secret`}
            type="password"
            value={draft.clientSecret}
            onChange={(event) => setDraft((current) => ({ ...current, clientSecret: event.target.value }))}
            placeholder={integration.clientSecretMasked ? `محفوظ حالياً (${integration.clientSecretMasked})` : "المفتاح السري"}
            dir="ltr"
          />
          {integration.clientSecretMasked ? (
            <p className="text-xs text-muted-foreground">اتركه فارغاً للإبقاء على المفتاح الحالي.</p>
          ) : null}
        </div>

        {integration.provider === "microsoft" ? (
          <div className="space-y-2">
            <Label htmlFor="microsoft-tenant-id" className="text-sm">Tenant ID</Label>
            <Input
              id="microsoft-tenant-id"
              value={draft.tenantId}
              onChange={(event) => setDraft((current) => ({ ...current, tenantId: event.target.value }))}
              placeholder="common"
              dir="ltr"
            />
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor={`${integration.provider}-redirect-uri`} className="text-sm">رابط إعادة توجيه مخصص (اختياري)</Label>
          <Input
            id={`${integration.provider}-redirect-uri`}
            value={draft.redirectUri}
            onChange={(event) => setDraft((current) => ({ ...current, redirectUri: event.target.value }))}
            placeholder={integration.defaultRedirectUri}
            dir="ltr"
          />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl bg-muted/40 p-3">
        <div>
          <p className="text-sm font-semibold">تفعيل الربط للمستخدمين</p>
          <p className="text-xs text-muted-foreground mt-1">
            عند الإيقاف يختفي زر الربط من صفحة رسائل البنك.
            {integration.updatedAt ? ` آخر تحديث: ${formatDate(integration.updatedAt)}` : ""}
          </p>
        </div>
        <Switch
          checked={draft.isEnabled}
          onCheckedChange={(checked) => setDraft((current) => ({ ...current, isEnabled: checked }))}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={handleSave} disabled={isBusy}>
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ المفاتيح"}
        </Button>
        <Button variant="outline" onClick={handleTest} disabled={isBusy || !integration.configured}>
          {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
          اختبار الاتصال
        </Button>
        {integration.hasDatabaseRecord ? (
          <Button variant="destructive" size="icon" onClick={handleDelete} disabled={isBusy} aria-label="حذف المفاتيح المحفوظة">
            {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export default function AdminIntegrationsCard() {
  const { data: integrations = [], isLoading } = useAdminIntegrations();

  return (
    <Card className="border-border/50 shadow-sm">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">تكامل البريد</h2>
            <p className="text-sm text-muted-foreground">
              مفاتيح OAuth الخاصة بـ Gmail و Outlook. بدونها لا يستطيع المستخدمون ربط بريدهم البنكي. المفاتيح السرية تُحفظ مشفّرة ولا تُعرض بعد الحفظ.
            </p>
          </div>
          <div className="h-11 w-11 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <Mail className="h-5 w-5" />
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {integrations.map((integration) => (
              <IntegrationForm key={integration.provider} integration={integration} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
