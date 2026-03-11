import { LogIn, ArrowRight, ShieldCheck, UserPlus, UserCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocation } from "wouter";
import { useState } from "react";
import { useLogin, useRegister } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";

const passwordGuidanceMessage = "استخدم 8 أحرف على الأقل مع حرف كبير وحرف صغير ورقم واحد على الأقل";

export default function Login() {
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [passwordGuidance, setPasswordGuidance] = useState("");
  const { toast } = useToast();
  
  const loginMutation = useLogin();
  const registerMutation = useRegister();
  const isLoading = loginMutation.isPending || registerMutation.isPending;
  const isLoginMode = mode === "login";

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
        await registerMutation.mutateAsync({ username, password, name, email });
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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden" dir="rtl">
      
      <div className="absolute top-[-10%] right-[-5%] w-96 h-96 bg-primary/20 rounded-full blur-3xl opacity-50 mix-blend-multiply pointer-events-none"></div>
      <div className="absolute bottom-[-10%] left-[-5%] w-96 h-96 bg-blue-500/20 rounded-full blur-3xl opacity-50 mix-blend-multiply pointer-events-none"></div>

      <div className="w-full max-w-md z-10 space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
        
        <div className="text-center space-y-3">
          <div className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-primary to-primary/70 shadow-lg shadow-primary/30 mb-2 transform rotate-3 hover:rotate-0 transition-all duration-300">
            <span className="text-5xl font-black text-white">إ</span>
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-foreground">التزام</h1>
          <p className="text-muted-foreground text-sm font-medium px-8">رفيقك الذكي لإدارة أموالك بوعي ومسؤولية</p>
        </div>

        <Card className="border-white/20 dark:border-white/10 shadow-2xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl rounded-3xl overflow-hidden">
          <CardHeader className="space-y-1 pb-6 pt-8 text-center border-b border-border/50 bg-muted/20">
            <CardTitle className="text-2xl font-bold">
              {isLoginMode ? "مرحباً بعودتك" : "إنشاء حساب جديد"}
            </CardTitle>
            <CardDescription className="text-base">
              {isLoginMode ? "قم بتسجيل الدخول للمتابعة" : "أدخل بياناتك لإنشاء حسابك"}
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-5 pt-6 pb-6 px-6">
              {/* Mode Selection Icons */}
              <div className="flex items-center justify-center gap-6 pb-4 border-b border-border/30">
                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className={`flex flex-col items-center gap-2 transition-all min-w-[90px] py-3 px-4 rounded-2xl ${mode === "login" ? "bg-primary/10 text-primary shadow-sm" : "text-muted-foreground hover:bg-muted/50"}`}
                >
                  <UserCircle className="h-8 w-8" />
                  <span className="text-sm font-semibold">تسجيل الدخول</span>
                </button>
                <div className="w-px h-12 bg-border/70"></div>
                <button
                  type="button"
                  onClick={() => setMode("register")}
                  className={`flex flex-col items-center gap-2 transition-all min-w-[90px] py-3 px-4 rounded-2xl ${mode === "register" ? "bg-primary/10 text-primary shadow-sm" : "text-muted-foreground hover:bg-muted/50"}`}
                >
                  <UserPlus className="h-8 w-8" />
                  <span className="text-sm font-semibold">إنشاء حساب</span>
                </button>
              </div>

              {!isLoginMode && (
                <>
                  <div className="space-y-2.5">
                    <Label htmlFor="name" className="text-sm font-semibold">الاسم الكامل</Label>
                    <Input 
                      id="name" 
                      placeholder="أدخل اسمك الكامل" 
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required 
                      className="h-12 bg-background/50 border-muted-foreground/20 focus:border-primary rounded-xl text-md"
                    />
                  </div>
                  <div className="space-y-2.5">
                    <Label htmlFor="email" className="text-sm font-semibold">البريد الإلكتروني</Label>
                    <Input 
                      id="email" 
                      type="email"
                      placeholder="example@mail.com" 
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required 
                      dir="ltr"
                      className="h-12 bg-background/50 border-muted-foreground/20 focus:border-primary rounded-xl text-md text-left"
                    />
                  </div>
                </>
              )}
              <div className="space-y-2.5">
                <Label htmlFor="username" className="text-sm font-semibold">اسم المستخدم</Label>
                <Input 
                  id="username" 
                  placeholder="أدخل اسم المستخدم" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required 
                  className="h-12 bg-background/50 border-muted-foreground/20 focus:border-primary rounded-xl text-md"
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
                  className="h-12 bg-background/50 border-muted-foreground/20 focus:border-primary rounded-xl text-md text-left"
                  dir="ltr"
                />
                {!isLoginMode && passwordGuidance ? (
                  <p className="text-xs font-medium text-amber-600 dark:text-amber-400">{passwordGuidance}</p>
                ) : null}
              </div>
            </CardContent>
            <CardFooter className="px-6 pb-8 pt-2 flex flex-col gap-4">
              <Button 
                type="submit" 
                className="w-full h-14 rounded-xl text-lg font-bold shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300"
                disabled={isLoading}
              >
                {isLoading ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    <span>جاري المعالجة...</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2">
                    <span>{isLoginMode ? "تسجيل الدخول" : "إنشاء الحساب"}</span>
                    <ArrowRight className="h-5 w-5 rotate-180" />
                  </div>
                )}
              </Button>
              
              <div className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground mt-2">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                <span>بياناتك مشفرة ومحمية بالكامل</span>
              </div>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
