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
import VariableObligationDetails from "@/pages/variable-obligation-details";
import Login from "@/pages/login";
import SavingsPlans from "@/pages/savings-plans";
import Settings from "@/pages/settings";
import AdminUsers from "@/pages/admin-users";
import { useUser } from "@/lib/hooks";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";

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
        <Route path="/financial-plans" component={SavingsPlans} />
        <Route path="/obligations/:id" component={VariableObligationDetails} />
        <Route path="/obligations" component={Obligations} />
        <Route path="/settings" component={Settings} />
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
    if (typeof window === "undefined") {
      return;
    }

    let baselineHeight = window.visualViewport?.height ?? window.innerHeight;
    let keyboardOpen = false;
    let restoreScrollY = window.scrollY;
    let pendingRestoreFrame = 0;

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
      }

      if (!keyboardLikelyOpen) {
        baselineHeight = Math.max(baselineHeight, viewportHeight);
        document.documentElement.style.setProperty("--app-safe-viewport-height", `${baselineHeight}px`);
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
        }
      }, 180);
    };

    updateViewportHeight();
    document.documentElement.style.setProperty("--app-safe-viewport-height", `${baselineHeight}px`);
    window.addEventListener("resize", updateViewportHeight);
    window.visualViewport?.addEventListener("resize", updateViewportHeight);
    window.visualViewport?.addEventListener("scroll", updateViewportHeight);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);

    return () => {
      window.cancelAnimationFrame(pendingRestoreFrame);
      window.removeEventListener("resize", updateViewportHeight);
      window.visualViewport?.removeEventListener("resize", updateViewportHeight);
      window.visualViewport?.removeEventListener("scroll", updateViewportHeight);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
