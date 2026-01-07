import { Shell } from "@/ui/shell";
import { isActivePath, usePathname } from "@/ui/router";
import { PlaceholderPage } from "@/ui/placeholder";
import { useAuth } from "@/ui/auth-context";
import { LoginPage } from "@/ui/login";
import { ProjectsPage } from "@/ui/projects";
import { FolderOpen, Loader2 } from "lucide-react";

const appNav = [
  { to: "/app/projects", label: "Projects", icon: <FolderOpen className="size-4" /> },
] as const;

function AppContent() {
  const pathname = usePathname();

  if (isActivePath(pathname, "/app/projects"))
    return <ProjectsPage />;
  
  return <PlaceholderPage title="Dashboard" description="High-level account overview and recent activity." />;
}

function AuthenticatedApp() {
  const { logout } = useAuth();

  return (
    <Shell
      title="slashevents.io"
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


