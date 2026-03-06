import { LogIn, ArrowRight, ShieldCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocation } from "wouter";
import { useState } from "react";
import { useLogin, useRegister } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";

export default function Login() {
  const [, setLocation] = useLocation();
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const { toast } = useToast();
  
  const loginMutation = useLogin();
  const registerMutation = useRegister();
  const isLoading = loginMutation.isPending || registerMutation.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      if (isRegisterMode) {
        await registerMutation.mutateAsync({ username, password, name, email });
        toast({ title: "تم إنشاء الحساب بنجاح", description: "مرحباً بك في التزام!" });
      } else {
        await loginMutation.mutateAsync({ username, password });
        toast({ title: "مرحباً بعودتك!", description: "تم تسجيل الدخول بنجاح" });
      }
      setLocation("/");
    } catch (error: any) {
      const msg = error.message?.includes(":")
        ? error.message.split(":").slice(1).join(":").trim()
        : "حدث خطأ، حاول مرة أخرى";
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
              {isRegisterMode ? "إنشاء حساب جديد" : "مرحباً بعودتك"}
            </CardTitle>
            <CardDescription className="text-base">
              {isRegisterMode ? "أدخل بياناتك لإنشاء حسابك" : "قم بتسجيل الدخول للمتابعة"}
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-5 pt-6 pb-6 px-6">
              {isRegisterMode && (
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
                  onChange={(e) => setPassword(e.target.value)}
                  required 
                  className="h-12 bg-background/50 border-muted-foreground/20 focus:border-primary rounded-xl text-md text-left"
                  dir="ltr"
                />
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
                    <span>{isRegisterMode ? "إنشاء الحساب" : "تسجيل الدخول"}</span>
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

        <p className="text-center text-sm text-muted-foreground font-medium">
          {isRegisterMode ? "لديك حساب بالفعل؟ " : "ليس لديك حساب؟ "}
          <button 
            onClick={() => setIsRegisterMode(!isRegisterMode)} 
            className="text-primary font-bold hover:underline underline-offset-4 transition-all cursor-pointer"
          >
            {isRegisterMode ? "سجل الدخول" : "سجل الآن"}
          </button>
        </p>
      </div>
    </div>
  );
}
