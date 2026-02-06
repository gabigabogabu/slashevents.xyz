import { useState, type FormEvent } from "react";
import { Shell } from "@/ui/shell";
import { usePathname, Link } from "@/ui/router";
import { useAuth } from "@/ui/auth-context";
import { useRpc, useRpcMutation } from "@/ui/use-rpc";
import { LoginPage } from "@/ui/login";
import { ProjectDetailPage } from "@/ui/projects";
import { cn } from "@/lib/utils";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ProjectTab = "overview" | "users" | "events";

export const tabs: { key: ProjectTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "users", label: "Users" },
  { key: "events", label: "Events" },
];

type Project = {
  id: string;
  name: string;
  createdAt: string;
};

const validTabs = new Set<string>(["overview", "users", "events"]);

function extractProjectRoute(pathname: string): { projectId: string; tab: ProjectTab } | null {
  const match = pathname.match(/^\/app\/projects\/([a-f0-9-]{36})(?:\/([\w]+))?$/i);
  if (!match) return null;
  const tab = match[2] && validTabs.has(match[2]) ? (match[2] as ProjectTab) : "overview";
  return { projectId: match[1]!, tab };
}

function CreateProjectForm({ onCreated }: { onCreated: () => void }) {
  const { authenticatedRpc } = useAuth();
  const [name, setName] = useState("");
  const { mutate: createProject, isLoading: loading, error } = useRpcMutation(
    async (projectName: string) => {
      await authenticatedRpc.createProject({ name: projectName });
    },
    {
      onSuccess: () => {
        setName("");
        onCreated();
      },
    },
  );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    void createProject(trimmed);
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-1">
      <Input
        placeholder="New project"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={loading}
        className="h-8 text-xs"
      />
      <Button type="submit" size="sm" disabled={loading || !name.trim()}>
        {loading ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
      </Button>
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </form>
  );
}

function SidebarContent({
  projects,
  isLoading,
  activeProjectId,
  activeTab,
  refetch,
}: {
  projects: Project[];
  isLoading: boolean;
  activeProjectId: string | null;
  activeTab: ProjectTab;
  refetch: () => void;
}) {
  return (
    <>
      <CreateProjectForm onCreated={refetch} />

      <div className="mt-4 flex flex-col gap-0.5">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : projects.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No projects yet.</p>
        ) : (
          projects.map((project) => {
            const isActive = project.id === activeProjectId;
            const basePath = `/app/projects/${project.id}`;

            return (
              <div key={project.id}>
                <Link
                  to={basePath}
                  className={cn(
                    "block py-1.5 px-2 text-sm truncate transition-colors hover:bg-accent",
                    isActive ? "font-semibold" : "text-muted-foreground",
                  )}
                >
                  {project.name}
                </Link>

                {isActive && (
                  <div className="flex flex-col gap-0.5 pl-4">
                    {tabs.map((t) => {
                      const tabPath = t.key === "overview" ? basePath : `${basePath}/${t.key}`;
                      const isTabActive = activeTab === t.key;
                      return (
                        <Link
                          key={t.key}
                          to={tabPath}
                          className={cn(
                            "block py-1 px-2 text-xs transition-colors hover:bg-accent",
                            isTabActive ? "font-semibold" : "text-muted-foreground",
                          )}
                        >
                          {t.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

function AuthenticatedApp() {
  const { logout, authenticatedRpc } = useAuth();
  const pathname = usePathname();

  const { data, isLoading, refetch } = useRpc(
    () => authenticatedRpc.getProjects() as Promise<{ projects: Project[] }>,
    { deps: [authenticatedRpc] },
  );
  const projects = data?.projects ?? [];

  const projectRoute = extractProjectRoute(pathname);
  const activeProjectId = projectRoute?.projectId ?? null;
  const activeTab = projectRoute?.tab ?? "overview";

  return (
    <Shell
      title="slashevents.io"
      sidebar={
        <SidebarContent
          projects={projects}
          isLoading={isLoading}
          activeProjectId={activeProjectId}
          activeTab={activeTab}
          refetch={refetch}
        />
      }
      onLogout={logout}
    >
      {projectRoute ? (
        <ProjectDetailPage projectId={projectRoute.projectId} tab={projectRoute.tab} />
      ) : (
        <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
          Select a project from the sidebar.
        </div>
      )}
    </Shell>
  );
}

export function AppUI() {
  const { state } = useAuth();

  if (state.status === "loading") {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state.status === "unauthenticated") {
    return <LoginPage />;
  }

  return <AuthenticatedApp />;
}
