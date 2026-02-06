import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@/ui/router";
import { useAuth } from "@/ui/auth-context";
import { useRpcMutation } from "@/ui/use-rpc";
import { ArrowLeft, Loader2 } from "lucide-react";

type Mode = "login" | "signup";

export function LoginPage() {
  const { login, signup } = useAuth();
  const [mode, setMode] = React.useState<Mode>("login");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [validationError, setValidationError] = React.useState<string | null>(null);

  const { mutate: doLogin, isLoading: loginLoading, error: loginError, reset: resetLogin } = useRpcMutation(
    async (e: string, p: string) => login(e, p)
  );

  const { mutate: doSignup, isLoading: signupLoading, error: signupError, reset: resetSignup } = useRpcMutation(
    async (e: string, p: string) => signup(e, p)
  );

  const isLoading = loginLoading || signupLoading;
  const error = validationError || (mode === "login" ? loginError : signupError);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (password.length < 8) {
      setValidationError("Password must be at least 8 characters");
      return;
    }

    if (mode === "login") {
      void doLogin(email, password);
    } else {
      void doSignup(email, password);
    }
  };

  const switchMode = () => {
    setMode(mode === "login" ? "signup" : "login");
    setValidationError(null);
    resetLogin();
    resetSignup();
  };

  return (
    <div className="mx-auto grid min-h-screen w-full max-w-md place-items-center p-4">
      <div className="w-full space-y-4">
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link to="/">
            <ArrowLeft className="size-4" />
            Back to home
          </Link>
        </Button>

        <Card className="w-full">
          <CardHeader className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-xl">
              {mode === "login" ? "Welcome back" : "Create account"}
            </CardTitle>
            <CardDescription>
              {mode === "login"
                ? "Sign in to your slashevents.io account"
                : "Get started with slashevents.io"}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isLoading}
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={isLoading}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              </div>

              {error && (
                <div className="bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="size-4 animate-spin" />}
                {mode === "login" ? "Sign in" : "Create account"}
              </Button>
            </form>

            <div className="mt-4 text-center text-sm text-muted-foreground">
              {mode === "login" ? (
                <>
                  Don't have an account?{" "}
                  <button
                    type="button"
                    onClick={switchMode}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Sign up
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={switchMode}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Sign in
                  </button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

