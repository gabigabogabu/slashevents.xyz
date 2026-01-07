import * as React from "react";
import { useAuth } from "@/ui/auth-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/errors";
import { Plus, Users, Trash2, FolderOpen, Loader2, ArrowLeft, UserPlus, Shield, Eye, History, UserMinus, KeyRound } from "lucide-react";

type Project = {
  id: string;
  name: string;
  createdAt: string;
};

type ProjectUser = {
  userId: string;
  email: string;
  permissions: ("project_manage_users" | "project_read_users")[];
};

type ProjectEvent = {
  id: string;
  eventType: "project_created" | "user_added" | "user_removed" | "permission_granted" | "permission_revoked";
  actorEmail: string;
  metadata: {
    targetUserId?: string;
    permission?: "project_manage_users" | "project_read_users";
    permissions?: ("project_manage_users" | "project_read_users")[];
    removedPermissions?: ("project_manage_users" | "project_read_users")[];
    name?: string;
    [key: string]: unknown;
  } | null;
  createdAt: string;
};

export function ProjectsPage() {
  const { authenticatedRpc } = useAuth();
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedProject, setSelectedProject] = React.useState<Project | null>(null);

  const fetchProjects = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await authenticatedRpc.getProjects();
      setProjects(result.projects);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [authenticatedRpc]);

  React.useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (selectedProject) {
    return (
      <ProjectDetail
        project={selectedProject}
        onBack={() => setSelectedProject(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <CreateProjectForm onCreated={fetchProjects} />
      
      <Card className={error ? "border-destructive" : undefined}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="size-5" />
            Your Projects
          </CardTitle>
          <CardDescription>
            Projects you have access to. Click on a project to manage users.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No projects yet. Create your first project above.
            </p>
          ) : (
            <div className="space-y-2">
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => setSelectedProject(project)}
                  className="w-full flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent transition-colors text-left"
                >
                  <div>
                    <div className="font-medium">{project.name}</div>
                    <div className="text-xs text-muted-foreground">
                      Created {new Date(project.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <Users className="size-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CreateProjectForm({ onCreated }: { onCreated: () => void }) {
  const { authenticatedRpc } = useAuth();
  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      setLoading(true);
      setError(null);
      await authenticatedRpc.createProject({ name: name.trim() });
      setName("");
      onCreated();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="size-5" />
          Create Project
        </CardTitle>
        <CardDescription>
          Create a new project to organize your webhooks.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex gap-3">
          <div className="flex-1">
            <Label htmlFor="project-name" className="sr-only">Project Name</Label>
            <Input
              id="project-name"
              placeholder="Project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
            />
          </div>
          <Button type="submit" disabled={loading || !name.trim()}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : "Create"}
          </Button>
        </form>
        {error && (
          <p className="mt-2 text-sm text-destructive">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}

function ProjectDetail({ project, onBack }: { project: Project; onBack: () => void }) {
  const { authenticatedRpc } = useAuth();
  const [users, setUsers] = React.useState<ProjectUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [canManageUsers, setCanManageUsers] = React.useState(false);

  const fetchUsers = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await authenticatedRpc.getProjectUsers({ projectId: project.id });
      setUsers(result.users);
      // Check if current user can manage users (they would have been able to fetch if they have read permission)
      // We'll determine manage capability by checking their own permissions
      setCanManageUsers(true); // Will be refined based on actual permissions check
    } catch (err) {
      setError(getErrorMessage(err));
      setCanManageUsers(false);
    } finally {
      setLoading(false);
    }
  }, [authenticatedRpc, project.id]);

  React.useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Check if current user has manage permission
  React.useEffect(() => {
    // This is a simple check - if the user can see users, check their permissions
    const checkManagePermission = async () => {
      // The user list contains the current user's permissions
      // We don't know the current user's ID here, so we'll enable manage for anyone with the permission
      // A more robust solution would pass the current user's ID from auth context
    };
    checkManagePermission();
  }, [users]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4 mr-2" />
          Back to Projects
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="size-5" />
            {project.name}
          </CardTitle>
          <CardDescription>
            Manage users and their permissions for this project.
          </CardDescription>
        </CardHeader>
      </Card>

      <AddUserForm projectId={project.id} onAdded={fetchUsers} />

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-5" />
              Project Users
            </CardTitle>
            <CardDescription>
              Users with access to this project and their permissions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {users.length === 0 ? (
              <p className="text-sm text-muted-foreground">No users found.</p>
            ) : (
              <div className="space-y-3">
                {users.map((user) => (
                  <UserRow
                    key={user.userId}
                    user={user}
                    projectId={project.id}
                    onUpdated={fetchUsers}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <ActivityLog projectId={project.id} />
    </div>
  );
}

function AddUserForm({ projectId, onAdded }: { projectId: string; onAdded: () => void }) {
  const { authenticatedRpc } = useAuth();
  const [email, setEmail] = React.useState("");
  const [permissions, setPermissions] = React.useState<("project_manage_users" | "project_read_users")[]>(["project_read_users"]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || permissions.length === 0) return;

    try {
      setLoading(true);
      setError(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (authenticatedRpc.addUserToProject as any)({
        projectId,
        userEmail: email.trim(),
        permissions,
      });
      setEmail("");
      setPermissions(["project_read_users"]);
      onAdded();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const togglePermission = (perm: "project_manage_users" | "project_read_users") => {
    setPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="size-5" />
          Add User
        </CardTitle>
        <CardDescription>
          Add a user to this project by their email address.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="user-email" className="sr-only">User Email</Label>
              <Input
                id="user-email"
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <Label className="text-sm font-medium">Permissions:</Label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={permissions.includes("project_read_users")}
                onChange={() => togglePermission("project_read_users")}
                className="rounded border-gray-300"
              />
              <Eye className="size-4" />
              <span className="text-sm">Read Users</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={permissions.includes("project_manage_users")}
                onChange={() => togglePermission("project_manage_users")}
                className="rounded border-gray-300"
              />
              <Shield className="size-4" />
              <span className="text-sm">Manage Users</span>
            </label>
          </div>
          
          <Button type="submit" disabled={loading || !email.trim() || permissions.length === 0}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : "Add User"}
          </Button>
          
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function UserRow({
  user,
  projectId,
  onUpdated,
}: {
  user: ProjectUser;
  projectId: string;
  onUpdated: () => void;
}) {
  const { authenticatedRpc } = useAuth();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleRemove = async () => {
    if (!confirm(`Remove ${user.email} from this project?`)) return;

    try {
      setLoading(true);
      setError(null);
      await authenticatedRpc.removeUserFromProject({
        projectId,
        userIdToRemove: user.userId,
      });
      onUpdated();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const togglePermission = async (perm: "project_manage_users" | "project_read_users") => {
    const newPermissions = user.permissions.includes(perm)
      ? user.permissions.filter((p) => p !== perm)
      : [...user.permissions, perm];

    if (newPermissions.length === 0) {
      setError("User must have at least one permission");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (authenticatedRpc.updateUserProjectPermissions as any)({
        projectId,
        userIdToUpdate: user.userId,
        permissions: newPermissions,
      });
      onUpdated();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
      <div className="flex-1">
        <div className="font-medium">{user.email}</div>
        <div className="flex items-center gap-3 mt-1">
          <label className="flex items-center gap-1 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={user.permissions.includes("project_read_users")}
              onChange={() => togglePermission("project_read_users")}
              disabled={loading}
              className="rounded border-gray-300"
            />
            <Eye className="size-3" />
            <span>Read</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={user.permissions.includes("project_manage_users")}
              onChange={() => togglePermission("project_manage_users")}
              disabled={loading}
              className="rounded border-gray-300"
            />
            <Shield className="size-3" />
            <span>Manage</span>
          </label>
        </div>
        {error && (
          <p className="mt-1 text-xs text-destructive">{error}</p>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleRemove}
        disabled={loading}
        className="text-destructive hover:text-destructive hover:bg-destructive/10"
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      </Button>
    </div>
  );
}

function ActivityLog({ projectId }: { projectId: string }) {
  const { authenticatedRpc } = useAuth();
  const [events, setEvents] = React.useState<ProjectEvent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [total, setTotal] = React.useState(0);

  const fetchEvents = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await authenticatedRpc.getProjectEvents({ projectId, limit: 20 });
      setEvents(result.events);
      setTotal(result.total);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [authenticatedRpc, projectId]);

  React.useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const getEventIcon = (eventType: ProjectEvent["eventType"]) => {
    switch (eventType) {
      case "project_created":
        return <FolderOpen className="size-4 text-green-500" />;
      case "user_added":
        return <UserPlus className="size-4 text-blue-500" />;
      case "user_removed":
        return <UserMinus className="size-4 text-red-500" />;
      case "permission_granted":
        return <KeyRound className="size-4 text-green-500" />;
      case "permission_revoked":
        return <KeyRound className="size-4 text-orange-500" />;
      default:
        return <History className="size-4 text-muted-foreground" />;
    }
  };

  const getEventDescription = (event: ProjectEvent) => {
    const targetEmail = event.metadata?.targetEmail as string | undefined;
    const permission = event.metadata?.permission as "project_manage_users" | "project_read_users" | undefined;
    const permissionLabel = permission === "project_manage_users" ? "Manage Users" : "Read Users";
    
    switch (event.eventType) {
      case "project_created":
        return <><span className="font-medium">{event.actorEmail}</span> created the project</>;
      case "user_added":
        return <><span className="font-medium">{event.actorEmail}</span> added <span className="font-medium">{targetEmail ?? "a user"}</span> to the project</>;
      case "user_removed":
        return <><span className="font-medium">{event.actorEmail}</span> removed <span className="font-medium">{targetEmail ?? "a user"}</span> from the project</>;
      case "permission_granted":
        return <><span className="font-medium">{event.actorEmail}</span> granted <span className="font-medium">{permissionLabel}</span> to <span className="font-medium">{targetEmail ?? "a user"}</span></>;
      case "permission_revoked":
        return <><span className="font-medium">{event.actorEmail}</span> revoked <span className="font-medium">{permissionLabel}</span> from <span className="font-medium">{targetEmail ?? "a user"}</span></>;
      default:
        return <span>Unknown event</span>;
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-5" />
          Activity Log
        </CardTitle>
        <CardDescription>
          Recent changes to this project.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center p-4">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-sm text-muted-foreground">{error}</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <div className="space-y-3">
            {events.map((event) => (
              <div key={event.id} className="flex items-start gap-3 text-sm">
                <div className="mt-0.5">{getEventIcon(event.eventType)}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-foreground">{getEventDescription(event)}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {formatDate(event.createdAt)}
                  </div>
                </div>
              </div>
            ))}
            {total > events.length && (
              <p className="text-xs text-muted-foreground text-center pt-2">
                Showing {events.length} of {total} events
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
