import * as React from "react";
import { appRpc } from "@/lib/rpc";

const JWT_STORAGE_KEY = "web-latch-jwt";

type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; token: string };

type AuthContextValue = {
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AuthState>({ status: "loading" });

  // Check for existing token on mount
  React.useEffect(() => {
    const storedToken = localStorage.getItem(JWT_STORAGE_KEY);
    if (storedToken) {
      setState({ status: "authenticated", token: storedToken });
    } else {
      setState({ status: "unauthenticated" });
    }
  }, []);

  const login = React.useCallback(async (email: string, password: string) => {
    const { jwtToken } = await appRpc.userLogin({ email, password });
    localStorage.setItem(JWT_STORAGE_KEY, jwtToken);
    setState({ status: "authenticated", token: jwtToken });
  }, []);

  const signup = React.useCallback(async (email: string, password: string) => {
    const { jwtToken } = await appRpc.userSignup({ email, password });
    localStorage.setItem(JWT_STORAGE_KEY, jwtToken);
    setState({ status: "authenticated", token: jwtToken });
  }, []);

  const logout = React.useCallback(() => {
    localStorage.removeItem(JWT_STORAGE_KEY);
    setState({ status: "unauthenticated" });
  }, []);

  const value = React.useMemo(
    () => ({ state, login, signup, logout }),
    [state, login, signup, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

