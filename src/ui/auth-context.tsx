import { useEffect, useState, useCallback, useMemo, useContext, createContext, type ReactNode } from "react";
import { appRpc, createAuthenticatedAppRpc } from "@/lib/rpc";

const JWT_STORAGE_KEY = "slashevents.io-jwt";

type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; token: string };

type AuthContextValue = {
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => void;
  authenticatedRpc: ReturnType<typeof createAuthenticatedAppRpc>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  // Check for existing token on mount
  useEffect(() => {
    const storedToken = localStorage.getItem(JWT_STORAGE_KEY);
    if (storedToken) {
      setState({ status: "authenticated", token: storedToken });
    } else {
      setState({ status: "unauthenticated" });
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { jwt } = await appRpc.userLogin({ email, password });
    localStorage.setItem(JWT_STORAGE_KEY, jwt);
    setState({ status: "authenticated", token: jwt });
  }, []);

  const signup = useCallback(async (email: string, password: string) => {
    const { jwt } = await appRpc.userSignup({ email, password });
    localStorage.setItem(JWT_STORAGE_KEY, jwt);
    setState({ status: "authenticated", token: jwt });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(JWT_STORAGE_KEY);
    setState({ status: "unauthenticated" });
  }, []);

  const getToken = useCallback(() => {
    if (state.status === "authenticated") {
      return state.token;
    }
    return localStorage.getItem(JWT_STORAGE_KEY);
  }, [state]);

  const authenticatedRpc = useMemo(
    () => createAuthenticatedAppRpc(getToken, logout),
    [getToken, logout]
  );

  const value = useMemo(
    () => ({ state, login, signup, logout, authenticatedRpc }),
    [state, login, signup, logout, authenticatedRpc]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

