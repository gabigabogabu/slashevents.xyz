import { Shell } from "@/ui/shell";
import { isActivePath, usePathname } from "@/ui/router";
import { PlaceholderPage } from "@/ui/placeholder";
import { useAuth } from "@/ui/auth-context";
import { LoginPage } from "@/ui/login";
import { LayoutDashboard, Users, Loader2 } from "lucide-react";

const appNav = [
  { to: "/app/dashboard", label: "Dashboard", icon: <LayoutDashboard className="size-4" /> },
  { to: "/app/users", label: "Users", icon: <Users className="size-4" /> },
] as const;

function AppContent() {
  const pathname = usePathname();

  if (isActivePath(pathname, "/app/users")) {
    return <PlaceholderPage title="Users" description="Invite users and manage account permissions." />;
  }

  // "/app" is redirected to "/app/dashboard" at the app router level.
  if (isActivePath(pathname, "/app/dashboard")) {
    return <PlaceholderPage title="Dashboard" description="High-level account overview and recent activity." />;
  }

  return <PlaceholderPage title="Dashboard" description="High-level account overview and recent activity." />;
}

function AuthenticatedApp() {
  const { logout } = useAuth();

  return (
    <Shell
      title="WebLatch — App"
      nav={[...appNav]}
      onLogout={logout}
    >
      <AppContent />
    </Shell>
  );
}

export function AppUI() {
  const { state } = useAuth();

  if (state.status === "loading") {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state.status === "unauthenticated") {
    return <LoginPage />;
  }

  return <AuthenticatedApp />;
}


