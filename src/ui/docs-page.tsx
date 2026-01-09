import { DocsUI } from "@/ui/docs";
import type { ApiDoc } from "@/server/docs/generate-docs";
import { Loader2 } from "lucide-react";
import { useFetch } from "@/ui/use-fetch";

export function DocsPage() {
  const { data: doc, error, isLoading } = useFetch<ApiDoc>("/docs/api.json");

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="text-center">
          <p className="text-destructive">
            Error loading documentation: {error.message}
          </p>
        </div>
      </div>
    );
  }

  if (isLoading || !doc) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <DocsUI doc={doc} />;
}
