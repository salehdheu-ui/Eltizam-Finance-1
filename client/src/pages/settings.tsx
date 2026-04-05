import { User, Shield, Bell, Moon, LogOut, ChevronLeft, Globe, Lock, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useUser, useLogout, useUpdateUser, useChangePassword } from "@/lib/hooks";

const currencies = [
  { id: "OMR", name: "الريال العماني", symbol: "ر.ع" },
  { id: "SAR", name: "الريال السعودي", symbol: "ر.س" },
  { id: "AED", name: "الدرهم الإماراتي", symbol: "د.إ" },
  { id: "USD", name: "الدولار الأمريكي", symbol: "$" },
  { id: "EUR", name: "اليورو", symbol: "€" },
];

const SETTINGS_STORAGE_KEYS = {
  darkMode: "eltizam:dark-mode",
  notifications: "eltizam:notifications",
  biometrics: "eltizam:biometrics",
  currency: "eltizam:currency",
} as const;

export default function Settings() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: user } = useUser();
  const logoutMutation = useLogout();
  const updateUserMutation = useUpdateUser();
  const changePasswordMutation = useChangePassword();
  
  const [darkMode, setDarkMode] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [biometrics, setBiometrics] = useState(false);
  
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState(user?.name || "");
  const [profileEmail, setProfileEmail] = useState(user?.email || "");

  const [isCurrencyOpen, setIsCurrencyOpen] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState(currencies[0]);

  const [isPasswordOpen, setIsPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    const storedDarkMode = localStorage.getItem(SETTINGS_STORAGE_KEYS.darkMode);
    const storedNotifications = localStorage.getItem(SETTINGS_STORAGE_KEYS.notifications);
    const storedBiometrics = localStorage.getItem(SETTINGS_STORAGE_KEYS.biometrics);
    const storedCurrencyId = localStorage.getItem(SETTINGS_STORAGE_KEYS.currency);

    const isDarkMode = storedDarkMode === "true";
    setDarkMode(isDarkMode);
    document.documentElement.classList.toggle("dark", isDarkMode);

    if (storedNotifications !== null) {
      setNotifications(storedNotifications === "true");
    }

    if (storedBiometrics !== null) {
      setBiometrics(storedBiometrics === "true");
    }

    if (storedCurrencyId) {
      const storedCurrency = currencies.find((currency) => currency.id === storedCurrencyId);
      if (storedCurrency) {
        setSelectedCurrency(storedCurrency);
      }
    }
  }, []);

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
      setLocation("/login");
    } catch {
      setLocation("/login");
    }
  };

  const toggleDarkMode = (checked: boolean) => {
    setDarkMode(checked);
    localStorage.setItem(SETTINGS_STORAGE_KEYS.darkMode, String(checked));
    if (checked) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateUserMutation.mutateAsync({ name: profileName, email: profileEmail });
      setIsEditProfileOpen(false);
      toast({ title: "تم الحفظ بنجاح", description: "تم تحديث بيانات الملف الشخصي" });
    } catch {
      toast({ title: "خطأ", description: "فشل تحديث البيانات", variant: "destructive" });
    }
  };

  const handleSelectCurrency = (currency: typeof currencies[0]) => {
    setSelectedCurrency(currency);
    localStorage.setItem(SETTINGS_STORAGE_KEYS.currency, currency.id);
    setIsCurrencyOpen(false);
    toast({ title: "تم تغيير العملة", description: `تم تعيين ${currency.name} كعملة أساسية` });
  };

  const handleNotificationsChange = (checked: boolean) => {
    setNotifications(checked);
    localStorage.setItem(SETTINGS_STORAGE_KEYS.notifications, String(checked));
  };

  const handleBiometricsChange = (checked: boolean) => {
    setBiometrics(checked);
    localStorage.setItem(SETTINGS_STORAGE_KEYS.biometrics, String(checked));
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({ title: "خطأ", description: "كلمات المرور الجديدة غير متطابقة", variant: "destructive" });
      return;
    }
    try {
      await changePasswordMutation.mutateAsync({ currentPassword, newPassword });
      setIsPasswordOpen(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "تمت العملية بنجاح", description: "تم تغيير رمز المرور الخاص بك" });
    } catch (error: any) {
      const msg = error.message?.includes(":") ? error.message.split(":").slice(1).join(":").trim() : "فشل تغيير كلمة المرور";
      toast({ title: "خطأ", description: msg, variant: "destructive" });
    }
  };

  const openEditProfile = () => {
    setProfileName(user?.name || "");
    setProfileEmail(user?.email || "");
    setIsEditProfileOpen(true);
  };

  const displayName = user?.name || "المستخدم";
  const initials = displayName.split(' ').map(n => n[0]).join(' ').substring(0, 3);

  return (
    <div className="flex flex-col h-full bg-background animate-in fade-in duration-300" dir="rtl">
      <header className="px-4 py-6 pb-2 sm:px-6 xl:px-8">
        <h1 className="text-2xl font-bold mb-6">الإعدادات</h1>
      </header>

      <div className="p-4 flex-1 overflow-auto pb-24 space-y-6 sm:p-6 xl:p-8">
        <Card className="p-3 border border-primary/10 bg-primary/5 text-sm text-muted-foreground">
          يتم حفظ تفضيلات الواجهة مثل العملة والوضع الليلي والإشعارات على هذا الجهاز لتبقى التجربة سلسة.
        </Card>
        
        <Card className="p-4 border-none shadow-md bg-card/50">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center text-primary font-bold text-xl">
              {initials}
            </div>
            <div className="flex-1">
              <h2 className="font-bold text-lg" data-testid="text-profile-name">{displayName}</h2>
              <p className="text-sm text-muted-foreground" data-testid="text-profile-email">{user?.email}</p>
            </div>
            <Button variant="outline" size="sm" onClick={openEditProfile} data-testid="button-edit-profile" className="sm:w-auto w-full">
              تعديل
            </Button>
          </div>
        </Card>

        <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground px-2">عام</h3>
          <div className="bg-card rounded-2xl border border-border/50 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => setIsCurrencyOpen(true)}>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 rounded-lg"><Globe className="h-5 w-5" /></div>
                <span className="font-medium">العملة الأساسية</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="text-sm">{selectedCurrency.symbol} ({selectedCurrency.id})</span>
                <ChevronLeft className="h-4 w-4" />
              </div>
            </div>
            <div className="flex items-center justify-between p-4 border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => toggleDarkMode(!darkMode)}>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-lg"><Moon className="h-5 w-5" /></div>
                <span className="font-medium">الوضع الليلي</span>
              </div>
              <Switch checked={darkMode} onCheckedChange={toggleDarkMode} />
            </div>
            <div className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => handleNotificationsChange(!notifications)}>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400 rounded-lg"><Bell className="h-5 w-5" /></div>
                <span className="font-medium">الإشعارات</span>
              </div>
              <Switch checked={notifications} onCheckedChange={handleNotificationsChange} />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground px-2">الأمان</h3>
          <div className="bg-card rounded-2xl border border-border/50 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => setIsPasswordOpen(true)}>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 rounded-lg"><Lock className="h-5 w-5" /></div>
                <span className="font-medium">تغيير رمز المرور</span>
              </div>
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => handleBiometricsChange(!biometrics)}>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-lg"><Shield className="h-5 w-5" /></div>
                <span className="font-medium">تفعيل البصمة / الوجه</span>
              </div>
              <Switch checked={biometrics} onCheckedChange={handleBiometricsChange} />
            </div>
          </div>
        </div>
        </div>

        <div className="pt-4 pb-8 xl:max-w-md">
          <Button variant="destructive" className="w-full py-6 rounded-xl font-bold text-lg shadow-sm cursor-pointer" onClick={handleLogout} disabled={logoutMutation.isPending} data-testid="button-logout">
            <LogOut className="mr-2 h-5 w-5 ml-2" />
            {logoutMutation.isPending ? "جاري الخروج..." : "تسجيل الخروج"}
          </Button>
        </div>
      </div>

      <Drawer open={isEditProfileOpen} onOpenChange={setIsEditProfileOpen}>
        <DrawerContent dir="rtl">
          <div className="mx-auto w-full max-w-lg">
            <DrawerHeader>
              <DrawerTitle>تعديل الملف الشخصي</DrawerTitle>
              <DrawerDescription>قم بتحديث بياناتك الشخصية هنا.</DrawerDescription>
            </DrawerHeader>
            <form onSubmit={handleSaveProfile} className="p-4 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">الاسم الكامل</Label>
                <Input id="name" value={profileName} onChange={(e) => setProfileName(e.target.value)} className="text-right" required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">البريد الإلكتروني</Label>
                <Input id="email" type="email" value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} dir="ltr" className="text-left" required />
              </div>
              <DrawerFooter className="px-0 pt-4">
                <Button type="submit" className="w-full" disabled={updateUserMutation.isPending}>
                  {updateUserMutation.isPending ? "جاري الحفظ..." : "حفظ التغييرات"}
                </Button>
                <DrawerClose asChild><Button variant="outline" className="w-full">إلغاء</Button></DrawerClose>
              </DrawerFooter>
            </form>
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer open={isPasswordOpen} onOpenChange={setIsPasswordOpen}>
        <DrawerContent dir="rtl">
          <div className="mx-auto w-full max-w-lg">
            <DrawerHeader>
              <DrawerTitle>تغيير رمز المرور</DrawerTitle>
              <DrawerDescription>قم بإدخال الرمز القديم والجديد.</DrawerDescription>
            </DrawerHeader>
            <form onSubmit={handleChangePassword} className="p-4 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="current-pass">رمز المرور الحالي</Label>
                <Input id="current-pass" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} dir="ltr" className="text-left" required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-pass">رمز المرور الجديد</Label>
                <Input id="new-pass" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} dir="ltr" className="text-left" required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm-pass">تأكيد رمز المرور الجديد</Label>
                <Input id="confirm-pass" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} dir="ltr" className="text-left" required />
              </div>
              <DrawerFooter className="px-0 pt-4">
                <Button type="submit" className="w-full" disabled={changePasswordMutation.isPending}>
                  {changePasswordMutation.isPending ? "جاري التغيير..." : "تغيير الرمز"}
                </Button>
                <DrawerClose asChild><Button variant="outline" className="w-full">إلغاء</Button></DrawerClose>
              </DrawerFooter>
            </form>
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer open={isCurrencyOpen} onOpenChange={setIsCurrencyOpen}>
        <DrawerContent dir="rtl">
          <div className="mx-auto w-full max-w-lg">
            <DrawerHeader>
              <DrawerTitle>العملة الأساسية</DrawerTitle>
              <DrawerDescription>اختر العملة التي ترغب في استخدامها لعرض مبالغك.</DrawerDescription>
            </DrawerHeader>
            <div className="p-4 flex flex-col gap-2">
              {currencies.map((currency) => (
                <div key={currency.id}
                  className={cn("flex items-center justify-between p-3 rounded-xl cursor-pointer border transition-all",
                    selectedCurrency.id === currency.id ? "border-primary bg-primary/5 text-primary font-medium" : "border-border/50 hover:bg-muted/50"
                  )}
                  onClick={() => handleSelectCurrency(currency)}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-semibold">{currency.symbol}</div>
                    <span>{currency.name}</span>
                  </div>
                  {selectedCurrency.id === currency.id && <Check className="h-5 w-5 text-primary" />}
                </div>
              ))}
            </div>
            <DrawerFooter>
              <DrawerClose asChild><Button variant="outline" className="w-full">إغلاق</Button></DrawerClose>
            </DrawerFooter>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
