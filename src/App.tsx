import "./index.css";
import { AppUI } from "@/ui/app";
import { LandingPage } from "@/ui/landing";
import { Redirect, usePathname } from "@/ui/router";
import { AuthProvider } from "@/ui/auth-context";

function AppRouter() {
  const pathname = usePathname();

  if (pathname === "/app" || pathname === "/app/") return <Redirect to="/app/dashboard" />;
  if (pathname.startsWith("/app")) return <AppUI />;
  // if (pathname === "/admin" || pathname === "/admin/") return <Redirect to="/admin/dashboard" />;
  // if (pathname.startsWith("/admin")) return <AdminUI />;

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
