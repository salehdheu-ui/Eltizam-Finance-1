import { ArrowRight, Mail, ShieldCheck, UserPlus, UserCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocation } from "wouter";
import { useState, useEffect } from "react";
import { useForgotPasswordRequest, useLogin, usePasswordResetSelfServiceComplete, usePasswordResetSelfServiceStart, useRegister } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";

const passwordGuidanceMessage = "استخدم 8 أحرف على الأقل مع حرف كبير وحرف صغير ورقم واحد على الأقل";
const forgotPasswordRequestHint = "أدخل اسم المستخدم أو البريد أو الهاتف للحصول على رمز مؤقت";
const phoneCountryOptions = [
  { code: "+968", label: "عُمان (+968)" },
  { code: "+966", label: "السعودية (+966)" },
  { code: "+971", label: "الإمارات (+971)" },
  { code: "+965", label: "الكويت (+965)" },
  { code: "+973", label: "البحرين (+973)" },
  { code: "+974", label: "قطر (+974)" },
];

export default function Login() {
  const [location, setLocation] = useLocation();
  const [mode, setMode] = useState<"login" | "register" | "forgotPassword">("login");
  const [forgotPasswordStep, setForgotPasswordStep] = useState<"request" | "verify">("request");
  const [contactMethod, setContactMethod] = useState<"email" | "phone">("email");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneCountryCode, setPhoneCountryCode] = useState(phoneCountryOptions[0].code);
  const [passwordGuidance, setPasswordGuidance] = useState("");
  const [resetIdentifier, setResetIdentifier] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetMaskedContact, setResetMaskedContact] = useState<string | null>(null);
  const [resetDeliveryMethod, setResetDeliveryMethod] = useState<"email" | "phone" | null>(null);
  const { toast } = useToast();
  
  const loginMutation = useLogin();
  const registerMutation = useRegister();
  const forgotPasswordRequestMutation = useForgotPasswordRequest();
  const passwordResetSelfServiceStartMutation = usePasswordResetSelfServiceStart();
  const passwordResetSelfServiceCompleteMutation = usePasswordResetSelfServiceComplete();
  const isLoading = loginMutation.isPending || registerMutation.isPending;
  const isLoginMode = mode === "login";
  const isForgotPasswordMode = mode === "forgotPassword";

  const resetForgotPasswordFlow = () => {
    setForgotPasswordStep("request");
    setResetIdentifier("");
    setResetToken("");
    setResetNewPassword("");
    setResetMaskedContact(null);
    setResetDeliveryMethod(null);
  };

  const switchToLoginMode = () => {
    resetForgotPasswordFlow();
    setMode("login");
    setLocation("/login");
  };

  const switchToForgotPasswordMode = () => {
    resetForgotPasswordFlow();
    setMode("forgotPassword");
    setLocation("/forgot-password");
  };

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = searchParams.get("token")?.trim() || "";

    if (location === "/forgot-password") {
      setMode("forgotPassword");
      setForgotPasswordStep("request");
      if (tokenFromUrl) {
        setResetToken(tokenFromUrl);
      }
      return;
    }

    if (location === "/reset-password") {
      setMode("forgotPassword");
      setForgotPasswordStep("verify");
      if (tokenFromUrl) {
        setResetToken(tokenFromUrl);
      }
      return;
    }

    setMode("login");
  }, [location]);

  const buildPhoneWithCountryCode = () => {
    const trimmedPhone = phone.trim();
    if (!trimmedPhone) {
      return "";
    }

    const normalizedPhone = trimmedPhone.replace(/^0+/, "");
    return `${phoneCountryCode}${normalizedPhone}`;
  };

  const isPasswordStrong = (value: string) => {
    return value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value);
  };

  const parseAuthErrorMessage = (error: any) => {
    const fallbackMessage = isLoginMode ? "حدث خطأ، حاول مرة أخرى" : "تعذر إنشاء الحساب، حاول مرة أخرى";
    const rawMessage = typeof error?.message === "string" ? error.message.trim() : "";

    if (!rawMessage) {
      return fallbackMessage;
    }

    if (rawMessage.includes("كلمة المرور ضعيفة")) {
      return `كلمة المرور ضعيفة. ${passwordGuidanceMessage}`;
    }

    if (rawMessage.includes("اسم المستخدم مستخدم بالفعل")) {
      return "اسم المستخدم مستخدم بالفعل";
    }

    if (rawMessage.includes("البريد الإلكتروني مستخدم بالفعل")) {
      return "البريد الإلكتروني مستخدم بالفعل";
    }

    if (rawMessage.includes("رقم الهاتف مستخدم بالفعل")) {
      return "رقم الهاتف مستخدم بالفعل";
    }

    if (rawMessage.includes("أدخل البريد الإلكتروني أو رقم الهاتف")) {
      return "أدخل البريد الإلكتروني أو رقم الهاتف";
    }

    if (rawMessage.includes("رقم الهاتف غير صالح")) {
      return "رقم الهاتف غير صالح";
    }

    if (rawMessage.includes("البريد الإلكتروني غير صالح")) {
      return "البريد الإلكتروني غير صالح";
    }

    if (rawMessage.includes("اسم المستخدم أو كلمة المرور غير صحيحة")) {
      return "اسم المستخدم أو كلمة المرور غير صحيحة";
    }

    if (rawMessage.includes("تم إيقاف هذا الحساب")) {
      return "تم إيقاف هذا الحساب";
    }

    return rawMessage.length > 180 ? fallbackMessage : rawMessage;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isLoginMode && !isPasswordStrong(password)) {
      setPasswordGuidance(passwordGuidanceMessage);
      toast({ title: "توجيه", description: passwordGuidanceMessage, variant: "destructive" });
      return;
    }
    
    try {
      if (isLoginMode) {
        await loginMutation.mutateAsync({ username, password });
        toast({ title: "مرحباً بعودتك!", description: "تم تسجيل الدخول بنجاح" });
      } else {
        await registerMutation.mutateAsync({
          username,
          password,
          name,
          email: contactMethod === "email" ? email : "",
          phone: contactMethod === "phone" ? buildPhoneWithCountryCode() : "",
        });
        setPasswordGuidance("");
        toast({ title: "تم إنشاء الحساب بنجاح", description: "مرحباً بك في التزام!" });
      }
      setLocation("/");
    } catch (error: any) {
      const msg = parseAuthErrorMessage(error);
      if (msg.includes("كلمة المرور ضعيفة")) {
        setPasswordGuidance(passwordGuidanceMessage);
      }
      toast({ title: "خطأ", description: msg, variant: "destructive" });
    }
  };

  const handleForgotPasswordSelfServiceStart = async () => {
    if (!resetIdentifier.trim()) {
      toast({ title: "تنبيه", description: "أدخل اسم المستخدم أو البريد أو الهاتف", variant: "destructive" });
      return;
    }

    try {
      const result = await passwordResetSelfServiceStartMutation.mutateAsync({
        identifier: resetIdentifier.trim(),
      });
      toast({ title: "رمز الاستعادة", description: result.message });
      if (!result.deliveryMethod || !result.maskedContact) {
        setResetMaskedContact(null);
        setResetDeliveryMethod(null);
        setForgotPasswordStep("request");
        return;
      }
      setResetMaskedContact(result.maskedContact);
      setResetDeliveryMethod(result.deliveryMethod);
      setForgotPasswordStep("verify");
      setLocation(result.debugCode ? `/reset-password?token=${encodeURIComponent(result.debugCode)}` : "/reset-password");
      if (result.debugCode) {
        toast({ title: "رمز التحقق التجريبي", description: result.debugCode });
      }
    } catch (error: any) {
      toast({ title: "خطأ", description: error?.message || "تعذر إنشاء رمز الاستعادة", variant: "destructive" });
    }
  };

  const handleForgotPasswordRequest = async () => {
    if (!resetIdentifier.trim()) {
      toast({ title: "تنبيه", description: "أدخل اسم المستخدم أو البريد أو الهاتف", variant: "destructive" });
      return;
    }

    try {
      await forgotPasswordRequestMutation.mutateAsync({
        identifier: resetIdentifier.trim(),
      });
      toast({ title: "تم استلام الطلب", description: "إذا كانت البيانات صحيحة فسيتم إرسال طلب إعادة التعيين للإدارة" });
    } catch (error: any) {
      toast({ title: "خطأ", description: error?.message || "تعذر إرسال طلب إعادة التعيين للإدارة", variant: "destructive" });
    }
  };

  const handleForgotPasswordComplete = async () => {
    if (!resetToken.trim() || !resetNewPassword.trim()) {
      toast({ title: "تنبيه", description: "أدخل رمز الاستعادة وكلمة المرور الجديدة", variant: "destructive" });
      return;
    }

    if (!isPasswordStrong(resetNewPassword)) {
      toast({ title: "توجيه", description: passwordGuidanceMessage, variant: "destructive" });
      return;
    }

    try {
      await passwordResetSelfServiceCompleteMutation.mutateAsync({
        token: resetToken.trim(),
        newPassword: resetNewPassword,
      });
      setResetIdentifier("");
      setResetToken("");
      setResetNewPassword("");
      setResetMaskedContact(null);
      setResetDeliveryMethod(null);
      setForgotPasswordStep("request");
      setMode("login");
      setLocation("/login");
      toast({ title: "تم بنجاح", description: "تمت إعادة تعيين كلمة المرور بنجاح" });
    } catch (error: any) {
      toast({ title: "خطأ", description: error?.message || "تعذر إكمال إعادة تعيين كلمة المرور", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_32%),linear-gradient(180deg,_hsl(var(--background))_0%,_hsl(var(--muted))_100%)] dark:bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_28%),linear-gradient(180deg,_#020617_0%,_#0f172a_100%)] flex flex-col items-center justify-center p-4 relative overflow-hidden" dir="rtl">
      
      <div className="absolute top-[-10%] right-[-5%] w-96 h-96 bg-primary/20 rounded-full blur-3xl opacity-50 mix-blend-multiply pointer-events-none"></div>
      <div className="absolute bottom-[-10%] left-[-5%] w-96 h-96 bg-blue-500/20 rounded-full blur-3xl opacity-50 mix-blend-multiply pointer-events-none"></div>

      <div className="w-full max-w-md z-10 space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
        
        <div className="text-center space-y-4">
          <div className="inline-flex h-20 w-20 items-center justify-center rounded-[2rem] bg-gradient-to-br from-primary via-primary to-blue-500 shadow-xl shadow-primary/30 mb-1 transform rotate-3 hover:rotate-0 transition-all duration-300 ring-1 ring-white/40 dark:ring-white/10">
            <span className="text-5xl font-black text-white">إ</span>
          </div>
          <div className="space-y-2">
            <h1 className="text-4xl font-extrabold tracking-tight text-foreground">التزام</h1>
            <p className="text-muted-foreground text-sm font-medium px-8 leading-7">رفيقك الذكي لإدارة أموالك بوعي ومسؤولية</p>
          </div>
        </div>

        <Card className="border-white/30 dark:border-white/10 shadow-[0_30px_80px_rgba(15,23,42,0.16)] bg-white/85 dark:bg-slate-900/85 backdrop-blur-2xl rounded-[2rem] overflow-hidden">
          <CardHeader className="space-y-2 pb-6 pt-8 text-center border-b border-border/40 bg-gradient-to-b from-white/70 to-white/20 dark:from-slate-900/60 dark:to-slate-900/20">
            <CardTitle className="text-2xl font-bold">
              {isForgotPasswordMode ? "استعادة كلمة المرور" : isLoginMode ? "مرحباً بعودتك" : "إنشاء حساب جديد"}
            </CardTitle>
            <CardDescription className="text-sm leading-7 max-w-sm mx-auto">
              {isForgotPasswordMode ? (forgotPasswordStep === "request" ? forgotPasswordRequestHint : "أدخل الرمز المؤقت ثم عيّن كلمة مرور جديدة") : isLoginMode ? "قم بتسجيل الدخول للمتابعة" : "أدخل بياناتك لإنشاء حسابك"}
            </CardDescription>
          </CardHeader>
          <form onSubmit={isForgotPasswordMode ? (e) => {
            e.preventDefault();
            if (forgotPasswordStep === "request") {
              void handleForgotPasswordSelfServiceStart();
              return;
            }
            void handleForgotPasswordComplete();
          } : handleSubmit}>
            <CardContent className="space-y-5 pt-6 pb-6 px-6">
              {!isForgotPasswordMode ? (
                <div className="grid grid-cols-2 gap-3 rounded-2xl bg-muted/40 p-2 border border-border/40">
                  <button
                    type="button"
                    onClick={() => setMode("login")}
                    className={`flex flex-col items-center gap-2 transition-all min-w-[90px] py-3 px-4 rounded-xl ${mode === "login" ? "bg-background text-primary shadow-sm border border-primary/15" : "text-muted-foreground hover:bg-background/70"}`}
                  >
                    <UserCircle className="h-8 w-8" />
                    <span className="text-sm font-semibold">تسجيل الدخول</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("register")}
                    className={`flex flex-col items-center gap-2 transition-all min-w-[90px] py-3 px-4 rounded-xl ${mode === "register" ? "bg-background text-primary shadow-sm border border-primary/15" : "text-muted-foreground hover:bg-background/70"}`}
                  >
                    <UserPlus className="h-8 w-8" />
                    <span className="text-sm font-semibold">إنشاء حساب</span>
                  </button>
                </div>
              ) : null}

              {!isLoginMode && !isForgotPasswordMode && (
                <>
                  <div className="space-y-2.5">
                    <Label className="text-sm font-semibold">طريقة التواصل للتسجيل</Label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setContactMethod("email")}
                        className={`h-11 rounded-xl border text-sm font-semibold transition-all ${contactMethod === "email" ? "border-primary/30 bg-primary/10 text-primary shadow-sm" : "border-border bg-background text-muted-foreground hover:bg-muted/40"}`}
                      >
                        البريد الإلكتروني
                      </button>
                      <button
                        type="button"
                        onClick={() => setContactMethod("phone")}
                        className={`h-11 rounded-xl border text-sm font-semibold transition-all ${contactMethod === "phone" ? "border-primary/30 bg-primary/10 text-primary shadow-sm" : "border-border bg-background text-muted-foreground hover:bg-muted/40"}`}
                      >
                        رقم الهاتف
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2.5">
                    <Label htmlFor="name" className="text-sm font-semibold">الاسم الكامل</Label>
                    <Input 
                      id="name" 
                      placeholder="أدخل اسمك الكامل" 
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required 
                      className="h-12 bg-background/60 border-muted-foreground/20 focus:border-primary rounded-xl text-md shadow-sm"
                    />
                  </div>
                  <div className="space-y-2.5">
                    <Label htmlFor="contact" className="text-sm font-semibold">
                      {contactMethod === "email" ? "البريد الإلكتروني" : "رقم الهاتف"}
                    </Label>
                    {contactMethod === "email" ? (
                      <Input 
                        id="contact" 
                        type="email"
                        placeholder="example@mail.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required 
                        dir="ltr"
                        className="h-12 bg-background/60 border-muted-foreground/20 focus:border-primary rounded-xl text-md text-left shadow-sm"
                      />
                    ) : (
                      <div className="flex gap-2" dir="ltr">
                        <select
                          value={phoneCountryCode}
                          onChange={(e) => setPhoneCountryCode(e.target.value)}
                          className="h-12 rounded-xl border border-muted-foreground/20 bg-background/60 px-3 text-sm focus:border-primary focus:outline-none shadow-sm"
                        >
                          {phoneCountryOptions.map((option) => (
                            <option key={option.code} value={option.code}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <Input 
                          id="contact" 
                          type="tel"
                          placeholder="91234567"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          required 
                          dir="ltr"
                          className="h-12 bg-background/60 border-muted-foreground/20 focus:border-primary rounded-xl text-md text-left shadow-sm"
                        />
                      </div>
                    )}
                  </div>
                </>
              )}
              {isForgotPasswordMode ? (
                <>
                  <div className="grid grid-cols-2 gap-3 rounded-2xl bg-muted/40 p-2 border border-border/40">
                    <button
                      type="button"
                      onClick={() => setForgotPasswordStep("request")}
                      className={`py-3 px-4 rounded-xl text-sm font-semibold transition-all ${forgotPasswordStep === "request" ? "bg-background text-primary shadow-sm border border-primary/15" : "text-muted-foreground hover:bg-background/70"}`}
                    >
                      1. طلب الرمز
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (resetMaskedContact) {
                          setForgotPasswordStep("verify");
                          setLocation("/reset-password");
                        }
                      }}
                      className={`py-3 px-4 rounded-xl text-sm font-semibold transition-all ${forgotPasswordStep === "verify" ? "bg-background text-primary shadow-sm border border-primary/15" : "text-muted-foreground hover:bg-background/70"}`}
                      disabled={!resetMaskedContact}
                    >
                      2. تعيين كلمة جديدة
                    </button>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reset-identifier" className="text-sm font-semibold">اسم المستخدم أو البريد أو الهاتف</Label>
                    <Input
                      id="reset-identifier"
                      value={resetIdentifier}
                      onChange={(e) => setResetIdentifier(e.target.value)}
                      placeholder="أدخل اسم المستخدم أو البريد أو الهاتف"
                      className="h-12 rounded-xl bg-background/60 shadow-sm"
                      dir="ltr"
                    />
                  </div>
                  {forgotPasswordStep === "verify" ? (
                    <>
                      <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-4 text-sm leading-7 text-foreground">
                        <div>
                          أدخل الرمز المرسل إلى {resetDeliveryMethod === "email" ? "البريد الإلكتروني" : resetDeliveryMethod === "phone" ? "رقم الهاتف" : "وسيلة التواصل"} المسجلة
                          {resetMaskedContact ? ` (${resetMaskedContact})` : ""}.
                        </div>
                        <div className="text-muted-foreground mt-2">
                          صلاحية الرمز قصيرة. إذا لم يصلك، يمكنك طلب رمز جديد أو طلب المساعدة من الإدارة.
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="reset-token" className="text-sm font-semibold">رمز الاستعادة</Label>
                        <Input
                          id="reset-token"
                          value={resetToken}
                          onChange={(e) => setResetToken(e.target.value)}
                          placeholder="أدخل رمز الاستعادة"
                          className="h-12 rounded-xl bg-background/60 shadow-sm text-left"
                          dir="ltr"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="reset-new-password" className="text-sm font-semibold">كلمة المرور الجديدة</Label>
                        <Input
                          id="reset-new-password"
                          type="password"
                          value={resetNewPassword}
                          onChange={(e) => setResetNewPassword(e.target.value)}
                          placeholder="••••••••"
                          className="h-12 rounded-xl bg-background/60 shadow-sm text-left"
                          dir="ltr"
                        />
                      </div>
                    </>
                  ) : (
                    <div className="rounded-2xl border border-border/40 bg-muted/30 px-4 py-4 text-sm leading-7 text-muted-foreground">
                      سننشئ لك رمزاً مؤقتاً لإعادة تعيين كلمة المرور. بعد وصوله انتقل مباشرة للخطوة الثانية.
                    </div>
                  )}
                  <div className="rounded-2xl border border-border/40 bg-muted/20 px-4 py-4 text-sm leading-7">
                    <div className="font-semibold text-foreground mb-2">تحتاج مساعدة؟</div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full rounded-xl"
                        onClick={() => void handleForgotPasswordRequest()}
                        disabled={forgotPasswordRequestMutation.isPending}
                      >
                        طلب مساعدة من الإدارة
                      </Button>
                      <a
                        href="mailto:saleh.dheu@gmail.com?subject=%D9%85%D8%B4%D9%83%D9%84%D8%A9%20%D9%81%D9%8A%20%D8%A7%D8%B3%D8%AA%D8%B9%D8%A7%D8%AF%D8%A9%20%D9%83%D9%84%D9%85%D8%A9%20%D8%A7%D9%84%D9%85%D8%B1%D9%88%D8%B1&body=%D8%A7%D8%B0%D9%83%D8%B1%20%D8%A7%D8%B3%D9%85%20%D8%A7%D9%84%D9%85%D8%B3%D8%AA%D8%AE%D8%AF%D9%85%20%D9%88%D9%88%D8%B3%D9%8A%D9%84%D8%A9%20%D8%A7%D9%84%D8%AA%D9%88%D8%A7%D8%B5%D9%84%20%D8%A7%D9%84%D9%85%D8%B3%D8%AC%D9%84%D8%A9%20%D9%88%D8%B5%D9%81%20%D8%A7%D9%84%D9%85%D8%B4%D9%83%D9%84%D8%A9."
                        className="flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted/40"
                      >
                        <Mail className="h-4 w-4" />
                        <span>الدعم عبر البريد</span>
                      </a>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2.5">
                    <Label htmlFor="username" className="text-sm font-semibold">اسم المستخدم</Label>
                    <Input 
                      id="username" 
                      placeholder="أدخل اسم المستخدم" 
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required 
                      className="h-12 bg-background/60 border-muted-foreground/20 focus:border-primary rounded-xl text-md shadow-sm"
                    />
                  </div>
                  <div className="space-y-2.5">
                    <Label htmlFor="password" className="text-sm font-semibold">كلمة المرور</Label>
                    <Input 
                      id="password" 
                      type="password" 
                      placeholder="••••••••" 
                      value={password}
                      onChange={(e) => {
                        const nextPassword = e.target.value;
                        setPassword(nextPassword);
                        if (!isLoginMode) {
                          if (!nextPassword) {
                            setPasswordGuidance("");
                          } else if (isPasswordStrong(nextPassword)) {
                            setPasswordGuidance("");
                          } else {
                            setPasswordGuidance(passwordGuidanceMessage);
                          }
                        }
                      }}
                      required 
                      className="h-12 bg-background/60 border-muted-foreground/20 focus:border-primary rounded-xl text-md text-left shadow-sm"
                      dir="ltr"
                    />
                    {!isLoginMode && passwordGuidance ? (
                      <p className="text-xs font-medium text-amber-600 dark:text-amber-400">{passwordGuidance}</p>
                    ) : null}
                  </div>
                </>
              )}
            </CardContent>
            <CardFooter className="px-6 pb-8 pt-2 flex flex-col gap-4">
              <Button 
                type="submit"
                className="w-full h-14 rounded-xl text-lg font-bold shadow-lg shadow-primary/25 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 bg-gradient-to-r from-primary to-blue-600"
                disabled={isForgotPasswordMode ? (forgotPasswordStep === "request" ? passwordResetSelfServiceStartMutation.isPending : passwordResetSelfServiceCompleteMutation.isPending) : isLoading}
              >
                {(isForgotPasswordMode ? (forgotPasswordStep === "request" ? passwordResetSelfServiceStartMutation.isPending : passwordResetSelfServiceCompleteMutation.isPending) : isLoading) ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    <span>جاري المعالجة...</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2">
                    <span>{isForgotPasswordMode ? (forgotPasswordStep === "request" ? "إرسال رمز الاستعادة" : "تأكيد الرمز وتعيين كلمة مرور جديدة") : isLoginMode ? "تسجيل الدخول" : "إنشاء الحساب"}</span>
                    <ArrowRight className="h-5 w-5 rotate-180" />
                  </div>
                )}
              </Button>
              
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground mt-1 rounded-xl bg-muted/30 border border-border/40 px-4 py-3">
                <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
                <span>بياناتك مشفرة ومحمية بالكامل</span>
              </div>

              {isLoginMode ? (
                <div className="w-full space-y-3">
                  <button
                    type="button"
                    onClick={switchToForgotPasswordMode}
                    className="w-full text-center text-sm font-semibold text-primary hover:text-primary/80 transition-colors rounded-xl py-2 hover:bg-primary/5"
                  >
                    نسيت كلمة المرور؟
                  </button>
                </div>
              ) : null}

              {isForgotPasswordMode ? (
                <div className="w-full space-y-2">
                  {forgotPasswordStep === "verify" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setForgotPasswordStep("request");
                        setResetToken("");
                        setResetNewPassword("");
                        setLocation("/forgot-password");
                      }}
                      className="w-full text-center text-sm font-semibold text-primary hover:text-primary/80 transition-colors rounded-xl py-2 hover:bg-primary/5"
                    >
                      طلب رمز جديد
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={switchToLoginMode}
                    className="w-full text-center text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors rounded-xl py-2 hover:bg-muted/40"
                  >
                    العودة إلى تسجيل الدخول
                  </button>
                </div>
              ) : null}
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
