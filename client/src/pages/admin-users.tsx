import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { DatabaseBackup, Loader2, Shield, Trash2, UserCheck, UserX, Users } from "lucide-react";
import { useAdminBackups, useAdminCreateManualBackup, useAdminDeleteUser, useAdminStats, useAdminUpdateUser, useAdminUsers, useUser } from "@/lib/hooks";
import { formatDate } from "@/lib/utils";
import { useState } from "react";

export default function AdminUsers() {
  const { toast } = useToast();
  const { data: currentUser } = useUser();
  const { data: stats, isLoading: isLoadingStats } = useAdminStats();
  const { data: users = [], isLoading: isLoadingUsers } = useAdminUsers();
  const { data: backups, isLoading: isLoadingBackups } = useAdminBackups();
  const updateUserMutation = useAdminUpdateUser();
  const deleteUserMutation = useAdminDeleteUser();
  const createManualBackupMutation = useAdminCreateManualBackup();
  const [pendingUserId, setPendingUserId] = useState<number | null>(null);

  const visibleUsers = users.filter((user) => user.role !== "system_admin");
  const backupGroups = [
    { label: "نسخ يومية", records: backups?.daily ?? [] },
    { label: "نسخ أسبوعية", records: backups?.weekly ?? [] },
    { label: "نسخة سنوية", records: backups?.annual ?? [] },
    { label: "نسخ يدوية", records: backups?.manual ?? [] },
  ];

  const handleToggleUser = async (id: number, isActive: boolean) => {
    if (updateUserMutation.isPending || deleteUserMutation.isPending) {
      return;
    }

    setPendingUserId(id);
    try {
      await updateUserMutation.mutateAsync({ id, isActive: !isActive });
      toast({
        title: "تم تحديث المستخدم",
        description: isActive ? "تم إيقاف الحساب" : "تم تفعيل الحساب",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "تعذر تحديث حالة المستخدم";
      toast({
        title: "خطأ",
        description: message,
        variant: "destructive",
      });
    } finally {
      setPendingUserId(null);
    }
  };

  const handleDeleteUser = async (id: number) => {
    if (deleteUserMutation.isPending || updateUserMutation.isPending) {
      return;
    }

    if (!window.confirm("هل تريد حذف هذا المستخدم وجميع بياناته المرتبطة؟")) {
      return;
    }

    setPendingUserId(id);
    try {
      await deleteUserMutation.mutateAsync(id);
      toast({
        title: "تم حذف المستخدم",
        description: "تم حذف الحساب وبياناته المرتبطة بنجاح",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "تعذر حذف المستخدم";
      toast({
        title: "خطأ",
        description: message,
        variant: "destructive",
      });
    } finally {
      setPendingUserId(null);
    }
  };

  const handleCreateManualBackup = async () => {
    if (createManualBackupMutation.isPending) {
      return;
    }

    try {
      await createManualBackupMutation.mutateAsync();
      toast({
        title: "تم إنشاء النسخة الاحتياطية",
        description: "تم إنشاء نسخة احتياطية يدوية بنجاح وتحديث القائمة.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "تعذر إنشاء النسخة الاحتياطية";
      toast({
        title: "خطأ",
        description: message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex flex-col gap-6 p-4 pt-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">لوحة مسؤول النظام</p>
          <h1 className="text-2xl font-bold">إدارة المستخدمين</h1>
        </div>
        <div className="h-11 w-11 rounded-full bg-primary/10 text-primary flex items-center justify-center">
          <Shield className="h-5 w-5" />
        </div>
      </header>

      <Card className="border-primary/10 bg-primary/5">
        <CardContent className="p-4 text-sm text-muted-foreground leading-7">
          لديك صلاحية إدارة الحسابات والعدادات العامة فقط. لا يتم عرض المحافظ أو المعاملات أو الالتزامات الخاصة بالمستخدمين داخل هذه الصفحة.
        </CardContent>
      </Card>

      <Card className="border-border/50 shadow-sm">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">النسخ الاحتياطي</h2>
              <p className="text-sm text-muted-foreground">خيارات النسخ الاحتياطي متاحة لمسؤول النظام فقط، وتشمل النسخ اليومية والأسبوعية والسنوية واليدوية.</p>
            </div>
            <div className="h-11 w-11 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <DatabaseBackup className="h-5 w-5" />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleCreateManualBackup} disabled={createManualBackupMutation.isPending}>
              {createManualBackupMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "إنشاء نسخة يدوية"}
            </Button>
          </div>

          <div className="grid gap-3">
            {backupGroups.map((group) => (
              <div key={group.label} className="rounded-xl border border-border/50 bg-muted/20 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold">{group.label}</h3>
                  <span className="text-xs text-muted-foreground">{group.records.length} ملف</span>
                </div>
                {isLoadingBackups ? (
                  <div className="flex justify-center py-3">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : group.records.length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا توجد ملفات ضمن هذا النوع حاليًا.</p>
                ) : (
                  <div className="space-y-2">
                    {group.records.map((record) => (
                      <div key={record.filePath} className="rounded-lg bg-background px-3 py-2 text-sm">
                        <p className="font-medium break-all" dir="ltr">{record.fileName}</p>
                        <p className="text-xs text-muted-foreground break-all" dir="ltr">{record.filePath}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "إجمالي المستخدمين", value: stats?.totalUsers ?? 0, icon: Users },
          { label: "المستخدمون النشطون", value: stats?.activeUsers ?? 0, icon: UserCheck },
          { label: "المستخدمون الموقوفون", value: stats?.inactiveUsers ?? 0, icon: UserX },
          { label: "دخول اليوم", value: stats?.usersLoggedInToday ?? 0, icon: Shield },
        ].map((item) => (
          <Card key={item.label} className="shadow-sm border-border/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <item.icon className="h-5 w-5 text-primary" />
                {isLoadingStats ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
              </div>
              <p className="text-sm text-muted-foreground">{item.label}</p>
              <p className="text-2xl font-bold mt-1">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">المستخدمون</h2>
          <span className="text-sm text-muted-foreground">{visibleUsers.length} حساب</span>
        </div>

        {isLoadingUsers ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : visibleUsers.length === 0 ? (
          <Card className="border-dashed border-border/50">
            <CardContent className="p-6 text-center text-muted-foreground">
              لا توجد حسابات متاحة للإدارة حاليًا.
            </CardContent>
          </Card>
        ) : (
          visibleUsers.map((user) => (
            <Card key={user.id} className="shadow-sm border-border/50">
              <CardContent className="p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold">{user.name}</h3>
                    <p className="text-sm text-muted-foreground" dir="ltr">{user.email}</p>
                    <p className="text-xs text-muted-foreground mt-1">@{user.username}</p>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full ${user.isActive ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                    {user.isActive ? "نشط" : "موقوف"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-muted/40 p-3">
                    <p className="text-muted-foreground mb-1">تاريخ الإنشاء</p>
                    <p className="font-medium">{user.createdAt ? formatDate(user.createdAt) : "-"}</p>
                  </div>
                  <div className="rounded-xl bg-muted/40 p-3">
                    <p className="text-muted-foreground mb-1">آخر دخول</p>
                    <p className="font-medium">{user.lastLoginAt ? formatDate(user.lastLoginAt) : "لا يوجد"}</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant={user.isActive ? "outline" : "default"}
                    className="flex-1"
                    onClick={() => handleToggleUser(user.id, user.isActive)}
                    disabled={updateUserMutation.isPending || deleteUserMutation.isPending || currentUser?.id === user.id}
                  >
                    {updateUserMutation.isPending && pendingUserId === user.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : user.isActive ? (
                      "إيقاف الحساب"
                    ) : (
                      "تفعيل الحساب"
                    )}
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={() => handleDeleteUser(user.id)}
                    disabled={deleteUserMutation.isPending || updateUserMutation.isPending || currentUser?.id === user.id}
                  >
                    {deleteUserMutation.isPending && pendingUserId === user.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
