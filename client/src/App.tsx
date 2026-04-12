import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Layout from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Transactions from "@/pages/transactions";
import Income from "@/pages/income";
import Wallets from "@/pages/wallets";
import Categories from "@/pages/categories";
import Reports from "@/pages/reports";
import Obligations from "@/pages/obligations";
import SavingsPlanDetails from "@/pages/savings-plan-details";
import SavingsGoalsPage from "@/pages/savings-goals";
import VariableObligationDetails from "@/pages/variable-obligation-details";
import Login from "@/pages/login";
import SavingsPlans from "@/pages/savings-plans";
import Settings from "@/pages/settings";
import UserGuidePage from "@/pages/user-guide";
import AdminUsers from "@/pages/admin-users";
import { useUser } from "@/lib/hooks";
import { Loader2 } from "lucide-react";
import React, { useEffect } from "react";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("App render error:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-min-h-screen flex items-center justify-center p-6" dir="rtl">
          <div className="w-full max-w-xl rounded-2xl border bg-background p-6 text-center">
            <p className="mb-2 text-lg font-bold text-red-600">حدث خطأ غير متوقع</p>
            <p className="text-sm text-muted-foreground">{this.state.error.message || "يرجى المحاولة مرة أخرى"}</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function isEditableElement(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { data: user, isLoading, error } = useUser();

  if (isLoading) {
    return (
      <div className="app-min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || error) {
    return <Redirect to="/login" />;
  }

  return <Component />;
}

function Router() {
  const [location] = useLocation();
  const { data: user, isLoading } = useUser();
  const isSystemAdmin = user?.role === "system_admin";
  const isPublicAuthRoute = location === "/login" || location === "/forgot-password" || location === "/reset-password";

  useEffect(() => {
    document.body.classList.remove("print-report-active");
  }, [location]);

  if (isLoading) {
    return (
      <div className="app-min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isPublicAuthRoute) {
    if (user) {
      return <Redirect to="/" />;
    }
    return (
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/forgot-password" component={Login} />
        <Route path="/reset-password" component={Login} />
      </Switch>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/transactions" component={Transactions} />
        <Route path="/income" component={Income} />
        <Route path="/wallets" component={Wallets} />
        <Route path="/categories" component={Categories} />
        <Route path="/reports" component={Reports} />
        <Route path="/financial-plans/:id" component={SavingsPlanDetails} />
        <Route path="/financial-plans" component={SavingsPlans} />
        <Route path="/savings-goals" component={SavingsGoalsPage} />
        <Route path="/obligations/:id" component={VariableObligationDetails} />
        <Route path="/obligations" component={Obligations} />
        <Route path="/settings" component={Settings} />
        <Route path="/user-guide" component={UserGuidePage} />
        {isSystemAdmin ? (
          <Route path="/admin/users" component={AdminUsers} />
        ) : location === "/admin/users" ? (
          <Redirect to="/" />
        ) : null}
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    document.documentElement.dir = "rtl";
    document.documentElement.lang = "ar";
    document.body.dir = "rtl";
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let baselineHeight = window.visualViewport?.height ?? window.innerHeight;
    let keyboardOpen = false;
    let restoreScrollY = window.scrollY;
    let pendingRestoreFrame = 0;
    const pendingTimeouts = new Set<number>();

    const syncViewportVars = (viewportHeight: number) => {
      document.documentElement.style.setProperty("--app-viewport-height", `${viewportHeight}px`);
      baselineHeight = Math.max(baselineHeight, viewportHeight, window.innerHeight);
      document.documentElement.style.setProperty("--app-safe-viewport-height", `${baselineHeight}px`);
    };

    const scheduleViewportRecovery = () => {
      const delays = [0, 60, 140, 260, 420];

      delays.forEach((delay) => {
        const timeout = window.setTimeout(() => {
          pendingTimeouts.delete(timeout);
          const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
          syncViewportVars(viewportHeight);
        }, delay);

        pendingTimeouts.add(timeout);
      });
    };

    const updateViewportHeight = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--app-viewport-height", `${viewportHeight}px`);

      const heightDelta = baselineHeight - viewportHeight;
      const keyboardLikelyOpen = heightDelta > 140;

      if (keyboardLikelyOpen && !keyboardOpen) {
        keyboardOpen = true;
        restoreScrollY = window.scrollY;
      }

      if (!keyboardLikelyOpen && keyboardOpen) {
        keyboardOpen = false;
        window.cancelAnimationFrame(pendingRestoreFrame);
        pendingRestoreFrame = window.requestAnimationFrame(() => {
          window.scrollTo({ top: restoreScrollY, behavior: "auto" });
        });
        scheduleViewportRecovery();
      }

      if (!keyboardLikelyOpen) {
        syncViewportVars(viewportHeight);
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (isEditableElement(event.target)) {
        restoreScrollY = window.scrollY;
      }
    };

    const handleFocusOut = (event: FocusEvent) => {
      if (!isEditableElement(event.target)) {
        return;
      }

      window.setTimeout(() => {
        const activeElement = document.activeElement;
        if (!isEditableElement(activeElement)) {
          window.scrollTo({ top: restoreScrollY, behavior: "auto" });
          scheduleViewportRecovery();
        }
      }, 180);
    };

    updateViewportHeight();
    syncViewportVars(window.visualViewport?.height ?? window.innerHeight);
    window.addEventListener("resize", updateViewportHeight);
    window.visualViewport?.addEventListener("resize", updateViewportHeight);
    window.visualViewport?.addEventListener("scroll", updateViewportHeight);
    window.addEventListener("orientationchange", scheduleViewportRecovery);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);

    return () => {
      window.cancelAnimationFrame(pendingRestoreFrame);
      pendingTimeouts.forEach((timeout) => window.clearTimeout(timeout));
      pendingTimeouts.clear();
      window.removeEventListener("resize", updateViewportHeight);
      window.visualViewport?.removeEventListener("resize", updateViewportHeight);
      window.visualViewport?.removeEventListener("scroll", updateViewportHeight);
      window.removeEventListener("orientationchange", scheduleViewportRecovery);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <ErrorBoundary>
          <Router />
        </ErrorBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
