import * as React from "react";
import { useAuth } from "@/ui/auth-context";
import { navigate, Link } from "@/ui/router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/errors";
import { EventType } from "@/index";
import { Plus, Users, Trash2, FolderOpen, Loader2, ArrowLeft, UserPlus, Shield, Eye, History, UserMinus, KeyRound, Webhook, ChevronRight, Globe, Clock, FileJson } from "lucide-react";

type Project = {
  id: string;
  name: string;
  createdAt: string;
};

type ProjectPermission = "project_manage_users" | "project_read_users" | "project_read_events";

type ProjectUser = {
  userId: string;
  email: string;
  permissions: ProjectPermission[];
};

type ProjectActivityEventType = 
  | "project.created"
  | "project.user.added"
  | "project.user.removed"
  | "project.user.permission.granted"
  | "project.user.permission.revoked";

type ProjectActivityEvent = {
  id: string;
  type: ProjectActivityEventType;
  actorEmail: string;
  data: {
    actorUserId: string;
    targetUserId?: string;
    targetEmail?: string;
    permission?: ProjectPermission;
    permissions?: ProjectPermission[];
    removedPermissions?: ProjectPermission[];
    name?: string;
    [key: string]: unknown;
  };
  receivedAt: string;
};

type WebhookEvent = {
  id: string;
  type: "webhook.received";
  httpMethod: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  path: string;
  headers: Record<string, string>;
  body: string | null;
  queryString: string | null;
  sourceIp: string | null;
  sourcePort: number | null;
  receivedAt: string;
};

type Event = ProjectActivityEvent | WebhookEvent;

export function ProjectsListPage() {
  const { authenticatedRpc } = useAuth();
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

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
                <Link
                  key={project.id}
                  to={`/app/projects/${project.id}`}
                  className="w-full flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent transition-colors text-left block"
                >
                  <div>
                    <div className="font-medium">{project.name}</div>
                    <div className="text-xs text-muted-foreground">
                      Created {new Date(project.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <Users className="size-4 text-muted-foreground" />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const { authenticatedRpc } = useAuth();
  const [project, setProject] = React.useState<Project | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const fetchProject = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await authenticatedRpc.getProject({ projectId });
        setProject(result.project);
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setLoading(false);
      }
    };
    fetchProject();
  }, [authenticatedRpc, projectId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/app/projects")}>
            <ArrowLeft className="size-4 mr-2" />
            Back to Projects
          </Button>
        </div>
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">{error ?? "Project not found"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <ProjectDetail project={project} />;
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

function ProjectDetail({ project }: { project: Project }) {
  const { authenticatedRpc } = useAuth();
  const [users, setUsers] = React.useState<ProjectUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchUsers = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await authenticatedRpc.getProjectUsers({ projectId: project.id });
      setUsers(result.users);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [authenticatedRpc, project.id]);

  React.useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/app/projects")}>
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

      <WebhookEvents projectId={project.id} />

      <ActivityLog projectId={project.id} />
    </div>
  );
}

function AddUserForm({ projectId, onAdded }: { projectId: string; onAdded: () => void }) {
  const { authenticatedRpc } = useAuth();
  const [email, setEmail] = React.useState("");
  const [permissions, setPermissions] = React.useState<ProjectPermission[]>(["project_read_users", "project_read_events"]);
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
      setPermissions(["project_read_users", "project_read_events"]);
      onAdded();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const togglePermission = (perm: ProjectPermission) => {
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
          
          <div className="flex items-center gap-4 flex-wrap">
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
                checked={permissions.includes("project_read_events")}
                onChange={() => togglePermission("project_read_events")}
                className="rounded border-gray-300"
              />
              <History className="size-4" />
              <span className="text-sm">Read Events</span>
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

  const togglePermission = async (perm: ProjectPermission) => {
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
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <label className="flex items-center gap-1 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={user.permissions.includes("project_read_users")}
              onChange={() => togglePermission("project_read_users")}
              disabled={loading}
              className="rounded border-gray-300"
            />
            <Eye className="size-3" />
            <span>Read Users</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={user.permissions.includes("project_read_events")}
              onChange={() => togglePermission("project_read_events")}
              disabled={loading}
              className="rounded border-gray-300"
            />
            <History className="size-3" />
            <span>Read Events</span>
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

function WebhookEvents({ projectId }: { projectId: string }) {
  const { authenticatedRpc } = useAuth();
  const [events, setEvents] = React.useState<WebhookEvent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [total, setTotal] = React.useState(0);
  const [showAll, setShowAll] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [hasMore, setHasMore] = React.useState(false);

  const fetchEvents = React.useCallback(async (append = false, cursorId?: string) => {
    try {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);
      const limit = showAll || append ? 20 : 3;
      const result = await authenticatedRpc.getEvents({ 
        projectId, 
        type: EventType.WEBHOOK_RECEIVED,
        limit,
        cursor: cursorId,
      });
      const webhookEvents = result.events.filter((e) => e.type === "webhook.received") as WebhookEvent[];
      if (append) {
        setEvents(prev => [...prev, ...webhookEvents]);
      } else {
        setEvents(webhookEvents);
      }
      setTotal(result.total);
      setHasMore(webhookEvents.length === limit && (append ? events.length + webhookEvents.length : webhookEvents.length) < result.total);
      if (webhookEvents.length > 0) {
        setCursor(webhookEvents[webhookEvents.length - 1]!.id);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [authenticatedRpc, projectId, showAll, events.length]);

  React.useEffect(() => {
    fetchEvents();
  }, [showAll]);

  const handleLoadMore = () => {
    if (cursor && hasMore) {
      fetchEvents(true, cursor);
    }
  };

  const getMethodColor = (method: WebhookEvent["httpMethod"]) => {
    switch (method) {
      case "GET":
        return "text-green-600 bg-green-100";
      case "POST":
        return "text-blue-600 bg-blue-100";
      case "PUT":
        return "text-yellow-600 bg-yellow-100";
      case "PATCH":
        return "text-orange-600 bg-orange-100";
      case "DELETE":
        return "text-red-600 bg-red-100";
      default:
        return "text-gray-600 bg-gray-100";
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

  const displayEvents = events;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Webhook className="size-5" />
              Received Webhooks
            </CardTitle>
            <CardDescription>
              Incoming webhook events for this project.
            </CardDescription>
          </div>
          {total > 0 && (
            <div className="text-sm text-muted-foreground">
              {total} total
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center p-4">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : events.length === 0 ? (
          <div className="text-center py-8">
            <Webhook className="size-12 mx-auto text-muted-foreground/50 mb-4" />
            <p className="text-sm text-muted-foreground mb-2">No webhooks received yet.</p>
            <p className="text-xs text-muted-foreground">
              Send webhooks to: <code className="bg-muted px-2 py-1 rounded">/ingress/{projectId}/your-path</code>
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayEvents.map((event) => (
              <div key={event.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
                <div className="flex-shrink-0">
                  <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-mono font-medium ${getMethodColor(event.httpMethod)}`}>
                    {event.httpMethod}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono truncate">{event.path}</code>
                    {event.queryString && (
                      <span className="text-xs text-muted-foreground truncate">?{event.queryString}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" />
                      {formatDate(event.receivedAt)}
                    </span>
                    {event.sourceIp && (
                      <span className="flex items-center gap-1">
                        <Globe className="size-3" />
                        {event.sourceIp}
                      </span>
                    )}
                    {event.body && (
                      <span className="flex items-center gap-1">
                        <FileJson className="size-3" />
                        {event.body.length} bytes
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
            
            {!showAll && total > 3 && (
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => setShowAll(true)}
              >
                View all webhooks
                <ChevronRight className="size-4 ml-2" />
              </Button>
            )}
            
            {showAll && hasMore && (
              <Button 
                variant="outline" 
                className="w-full"
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    Load more
                    <ChevronRight className="size-4 ml-2" />
                  </>
                )}
              </Button>
            )}
            
            {showAll && !hasMore && events.length > 3 && (
              <p className="text-xs text-muted-foreground text-center pt-2">
                Showing all {events.length} events
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityLog({ projectId }: { projectId: string }) {
  const { authenticatedRpc } = useAuth();
  const [events, setEvents] = React.useState<ProjectActivityEvent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [total, setTotal] = React.useState(0);

  const fetchEvents = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await authenticatedRpc.getEvents({ projectId, limit: 20 });
      const activityEvents = result.events.filter((e) => e.type.startsWith("project.")) as ProjectActivityEvent[];
      setEvents(activityEvents);
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

  const getEventIcon = (eventType: ProjectActivityEvent["type"]) => {
    switch (eventType) {
      case "project.created":
        return <FolderOpen className="size-4 text-green-500" />;
      case "project.user.added":
        return <UserPlus className="size-4 text-blue-500" />;
      case "project.user.removed":
        return <UserMinus className="size-4 text-red-500" />;
      case "project.user.permission.granted":
        return <KeyRound className="size-4 text-green-500" />;
      case "project.user.permission.revoked":
        return <KeyRound className="size-4 text-orange-500" />;
      default:
        return <History className="size-4 text-muted-foreground" />;
    }
  };

  const getEventDescription = (event: ProjectActivityEvent) => {
    const targetEmail = event.data.targetEmail;
    const permission = event.data.permission;
    const permissionLabel = permission === "project_manage_users" ? "Manage Users" : 
                            permission === "project_read_events" ? "Read Events" : "Read Users";
    
    switch (event.type) {
      case "project.created":
        return <><span className="font-medium">{event.actorEmail}</span> created the project</>;
      case "project.user.added":
        return <><span className="font-medium">{event.actorEmail}</span> added <span className="font-medium">{targetEmail ?? "a user"}</span> to the project</>;
      case "project.user.removed":
        return <><span className="font-medium">{event.actorEmail}</span> removed <span className="font-medium">{targetEmail ?? "a user"}</span> from the project</>;
      case "project.user.permission.granted":
        return <><span className="font-medium">{event.actorEmail}</span> granted <span className="font-medium">{permissionLabel}</span> to <span className="font-medium">{targetEmail ?? "a user"}</span></>;
      case "project.user.permission.revoked":
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
                <div className="mt-0.5">{getEventIcon(event.type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-foreground">{getEventDescription(event)}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {formatDate(event.receivedAt)}
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
