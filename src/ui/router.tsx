import * as React from "react";

export function navigate(to: string, opts?: { replace?: boolean }) {
  if (typeof window === "undefined") return;

  const url = new URL(to, window.location.origin);
  if (opts?.replace) window.history.replaceState({}, "", url);
  else window.history.pushState({}, "", url);

  // Ensure hooks subscribed to `popstate` re-render after push/replace.
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function usePathname() {
  return React.useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("popstate", onStoreChange);
      return () => window.removeEventListener("popstate", onStoreChange);
    },
    () => window.location.pathname,
    () => "/",
  );
}

export function Link({
  to,
  onClick,
  ...props
}: Omit<React.ComponentProps<"a">, "href"> & { to: string }) {
  const isExternal = /^https?:\/\//.test(to);
  return (
    <a
      href={to}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;

        // Let the browser handle new tabs, modifiers, etc.
        if (
          isExternal ||
          e.button !== 0 ||
          e.metaKey ||
          e.altKey ||
          e.ctrlKey ||
          e.shiftKey
        ) {
          return;
        }

        e.preventDefault();
        navigate(to);
      }}
      {...props}
    />
  );
}

export function isActivePath(pathname: string, to: string) {
  if (to === "/") return pathname === "/";
  if (pathname === to) return true;
  return pathname.startsWith(to.endsWith("/") ? to : `${to}/`);
}

export function Redirect({ to, replace = true }: { to: string; replace?: boolean }) {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.pathname === to) return;
    navigate(to, { replace });
  }, [to, replace]);

  return null;
}


