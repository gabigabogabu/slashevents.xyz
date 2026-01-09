import { useEffect, useState } from "react";
import { DocsUI } from "@/ui/docs";
import type { ApiDoc } from "@/server/docs/generate-docs";
import { Loader2 } from "lucide-react";

export function DocsPage() {
  const [doc, setDoc] = useState<ApiDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/docs/api.json")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch docs");
        return res.json();
      })
      .then(setDoc)
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="text-center">
          <p className="text-destructive">Error loading documentation: {error}</p>
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <DocsUI doc={doc} />;
}
