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
import Settings from "@/pages/settings";
import AdminUsers from "@/pages/admin-users";
import { useUser } from "@/lib/hooks";
import { Loader2 } from "lucide-react";

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { data: user, isLoading, error } = useUser();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
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

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (location === "/login") {
    if (user) {
      return <Redirect to="/" />;
    }
    return <Route path="/login" component={Login} />;
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
