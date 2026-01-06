import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isActivePath, Link, usePathname } from "@/ui/router";
import { LogOut } from "lucide-react";

export type ShellNavItem = {
  to: string;
  label: string;
  icon?: React.ReactNode;
};

function SidebarLink({ item }: { item: ShellNavItem }) {
  const pathname = usePathname();
  const active = isActivePath(pathname, item.to);

  return (
    <Button
      asChild
      variant={active ? "secondary" : "ghost"}
      className={cn("w-full justify-start gap-2", active && "font-semibold")}
    >
      <Link to={item.to}>
        {item.icon}
        <span>{item.label}</span>
      </Link>
    </Button>
  );
}

export function Shell({
  title,
  badge,
  nav,
  children,
  onLogout,
}: React.PropsWithChildren<{
  title: string;
  badge?: React.ReactNode;
  nav: ShellNavItem[];
  onLogout?: () => void;
}>) {
  return (
    <div className="min-h-screen w-full">
      <div className="flex min-h-screen w-full">
        <aside className="flex w-64 shrink-0 flex-col border-r bg-card/40 p-4">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">{title}</div>
            {badge}
          </div>

          <nav className="flex flex-1 flex-col gap-1">
            {nav.map((item) => (
              <SidebarLink key={item.to} item={item} />
            ))}
          </nav>

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


