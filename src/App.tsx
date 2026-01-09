import "./index.css";
import { AppUI } from "@/ui/app";
import { LandingPage } from "@/ui/landing";
import { DocsPage } from "@/ui/docs-page";
import { Redirect, usePathname } from "@/ui/router";
import { AuthProvider } from "@/ui/auth-context";

function AppRouter() {
  const pathname = usePathname();

  if (pathname === "/app" || pathname === "/app/") return <Redirect to="/app/dashboard" />;
  if (pathname.startsWith("/app")) return <AppUI />;
  // if (pathname === "/admin" || pathname === "/admin/") return <Redirect to="/admin/dashboard" />;
  // if (pathname.startsWith("/admin")) return <AdminUI />;
  if (pathname === "/docs" || pathname === "/docs/") return <Redirect to="/docs/api" />;
  if (pathname.startsWith("/docs")) return <DocsPage />;

  return <LandingPage />;
}

export function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}

export default App;
