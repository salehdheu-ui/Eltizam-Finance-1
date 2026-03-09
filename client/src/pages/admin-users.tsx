import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Shield, Trash2, UserCheck, UserX, Users } from "lucide-react";
import { useAdminDeleteUser, useAdminStats, useAdminUpdateUser, useAdminUsers, useUser } from "@/lib/hooks";

export default function AdminUsers() {
  const { toast } = useToast();
  const { data: currentUser } = useUser();
  const { data: stats, isLoading: isLoadingStats } = useAdminStats();
  const { data: users = [], isLoading: isLoadingUsers } = useAdminUsers();
  const updateUserMutation = useAdminUpdateUser();
  const deleteUserMutation = useAdminDeleteUser();

  const visibleUsers = users.filter((user) => user.role !== "system_admin");

  const handleToggleUser = async (id: number, isActive: boolean) => {
    try {
      await updateUserMutation.mutateAsync({ id, isActive: !isActive });
      toast({
        title: "تم تحديث المستخدم",
        description: isActive ? "تم إيقاف الحساب" : "تم تفعيل الحساب",
      });
    } catch (error: any) {
      toast({
        title: "خطأ",
        description: error?.message || "تعذر تحديث حالة المستخدم",
        variant: "destructive",
      });
    }
  };

  const handleDeleteUser = async (id: number) => {
    try {
      await deleteUserMutation.mutateAsync(id);
      toast({
        title: "تم حذف المستخدم",
        description: "تم حذف الحساب وبياناته المرتبطة بنجاح",
      });
    } catch (error: any) {
      toast({
        title: "خطأ",
        description: error?.message || "تعذر حذف المستخدم",
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
                    <p className="font-medium">{user.createdAt ? new Date(user.createdAt * 1000).toLocaleDateString("ar") : "-"}</p>
                  </div>
                  <div className="rounded-xl bg-muted/40 p-3">
                    <p className="text-muted-foreground mb-1">آخر دخول</p>
                    <p className="font-medium">{user.lastLoginAt ? new Date(user.lastLoginAt * 1000).toLocaleDateString("ar") : "لا يوجد"}</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant={user.isActive ? "outline" : "default"}
                    className="flex-1"
                    onClick={() => handleToggleUser(user.id, user.isActive)}
                    disabled={updateUserMutation.isPending || deleteUserMutation.isPending || currentUser?.id === user.id}
                  >
                    {updateUserMutation.isPending ? (
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
                    {deleteUserMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
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
