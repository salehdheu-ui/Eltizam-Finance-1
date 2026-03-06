import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Layout from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Transactions from "@/pages/transactions";
import Wallets from "@/pages/wallets";
import Categories from "@/pages/categories";
import Settings from "@/pages/settings";
import Login from "@/pages/login";
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

  if (location === "/login") {
    if (!isLoading && user) {
      return <Redirect to="/" />;
    }
    return <Route path="/login" component={Login} />;
  }

  return (
    <Layout>
      <Switch>
        <Route path="/" component={() => <ProtectedRoute component={Dashboard} />} />
        <Route path="/transactions" component={() => <ProtectedRoute component={Transactions} />} />
        <Route path="/wallets" component={() => <ProtectedRoute component={Wallets} />} />
        <Route path="/categories" component={() => <ProtectedRoute component={Categories} />} />
        <Route path="/settings" component={() => <ProtectedRoute component={Settings} />} />
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
