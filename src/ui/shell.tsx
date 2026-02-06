import * as React from "react";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export function Shell({
  title,
  sidebar,
  children,
  onLogout,
}: React.PropsWithChildren<{
  title: string;
  sidebar?: React.ReactNode;
  onLogout?: () => void;
}>) {
  return (
    <div className="min-h-screen w-full">
      <div className="flex min-h-screen w-full">
        <aside className="flex w-64 shrink-0 flex-col border-r bg-card/40 p-4">
          <div className="mb-4 text-sm font-semibold">{title}</div>

          <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
            {sidebar}
          </div>

          {onLogout && (
            <Button
              variant="ghost"
              className="mt-auto w-full justify-start gap-2 text-muted-foreground"
              onClick={onLogout}
            >
              <LogOut className="size-4" />
              <span>Sign out</span>
            </Button>
          )}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <main className="mx-auto w-full max-w-6xl flex-1 p-4">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}


