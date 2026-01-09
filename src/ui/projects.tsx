import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/ui/auth-context";
import { useRpc, useRpcMutation } from "@/ui/use-rpc";
import { navigate, Link } from "@/ui/router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EventType } from "@/lib/event-types";
import { Copy, EyeOff, Plus, Users, Trash2, FolderOpen, Loader2, ArrowLeft, UserPlus, Shield, Eye, History, UserMinus, KeyRound, Webhook, ChevronRight, Globe, Clock, FileJson } from "lucide-react";
import { ProjectPermission } from "@/lib/project-permissions";

type Project = {
  id: string;
  name: string;
  createdAt: string;
};

type ProjectUser = {
  userId: string;
  email: string;
  permissions: ProjectPermission[];
};

type ProjectActivityEventType = 
  | "PROJECT_CREATED"
  | "PROJECT_USER_ADDED"
  | "PROJECT_USER_REMOVED"
  | "PROJECT_USER_PERMISSION_GRANTED"
  | "PROJECT_USER_PERMISSION_REVOKED";

type EventDto = {
  id: string;
  projectId: string;
  type: EventType;
  data: unknown;
  receivedAt: string;
  actorEmail?: string;
};

type ProjectActivityEventData = {
  actorUserId: string;
  targetUserId?: string;
  targetEmail?: string;
  permission?: ProjectPermission;
  permissions?: ProjectPermission[];
  removedPermissions?: ProjectPermission[];
  name?: string;
  [key: string]: unknown;
};

type ProjectActivityEvent = Omit<EventDto, "type" | "data"> & {
  type: ProjectActivityEventType;
  data: ProjectActivityEventData;
};

type WebhookEventData = {
  httpMethod: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  path: string;
  headers: Record<string, string>;
  body: string | null;
  queryString: string | null;
  sourceIp: string | null;
  sourcePort: number | null;
};

type WebhookEvent = Omit<EventDto, "type" | "data"> & {
  type: EventType.WEBHOOK_RECEIVED;
  data: WebhookEventData;
};

type Event = ProjectActivityEvent | WebhookEvent;

export function ProjectsListPage() {
  const { authenticatedRpc } = useAuth();
  const { data, isLoading, error, refetch: refetchProjects } = useRpc(
    () => authenticatedRpc.getProjects() as Promise<{ projects: Project[] }>,
    { deps: [authenticatedRpc] }
  );

  const projects = data?.projects ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <CreateProjectForm onCreated={refetchProjects} />
      
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
  const { data, isLoading, error } = useRpc(
    () => authenticatedRpc.getProject({ projectId }) as Promise<{ project: Project }>,
    { deps: [authenticatedRpc, projectId] }
  );
  const project = data?.project ?? null;

  if (isLoading) {
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
    }
  );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    void createProject(trimmed);
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
  const { data: usersResult, isLoading: loading, error, refetch: refetchUsers } = useRpc(
    () => authenticatedRpc.getProjectUsers({ projectId: project.id }) as Promise<{ users: ProjectUser[] }>,
    { deps: [authenticatedRpc, project.id] }
  );
  const users = usersResult?.users ?? [];
  const [showApiKey, setShowApiKey] = useState(false);

  const {
    mutate: fetchApiKey,
    isLoading: apiKeyLoading,
    data: apiKeyData,
    error: apiKeyError,
  } = useRpcMutation(
    async () => {
      const result = await authenticatedRpc.getProjectApiKey({ projectId: project.id });
      return result.apiKey;
    }
  );
  const apiKey = apiKeyData;

  const toggleApiKey = async () => {
    if (showApiKey) {
      setShowApiKey(false);
      return;
    }
    setShowApiKey(true);
    if (apiKey) return;
    const result = await fetchApiKey();
    if (!result) {
      setShowApiKey(false);
    }
  };

  const copyApiKey = async () => {
    if (!apiKey) return;
    await navigator.clipboard.writeText(apiKey);
  };

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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-5" />
            API Key
          </CardTitle>
          <CardDescription>
            Use this key to read events via the API.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              value={apiKey ?? ""}
              readOnly
              placeholder={apiKeyLoading ? "Loading..." : "Hidden"}
              type={showApiKey ? "text" : "password"}
            />
            <Button variant="outline" onClick={toggleApiKey} disabled={apiKeyLoading}>
              {showApiKey ? (
                <>
                  <EyeOff className="size-4 mr-2" />
                  Hide
                </>
              ) : (
                <>
                  <Eye className="size-4 mr-2" />
                  Show
                </>
              )}
            </Button>
            <Button variant="outline" onClick={copyApiKey} disabled={!apiKey}>
              <Copy className="size-4 mr-2" />
              Copy
            </Button>
          </div>
          {apiKeyError && <p className="text-sm text-destructive">{apiKeyError}</p>}
        </CardContent>
      </Card>

      <AddUserForm projectId={project.id} onAdded={refetchUsers} />

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
                    onUpdated={refetchUsers}
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
  const [email, setEmail] = useState("");
  const [permissions, setPermissions] = useState<ProjectPermission[]>([ProjectPermission.PROJECT_READ_USERS, ProjectPermission.PROJECT_READ_EVENTS]);

  const { mutate: addUser, isLoading: loading, error } = useRpcMutation(
    async (userEmail: string, perms: ProjectPermission[]) => {
      await authenticatedRpc.addUserToProject({
        projectId,
        userEmail,
        permissions: perms,
      });
    },
    {
      onSuccess: () => {
        setEmail("");
        setPermissions([ProjectPermission.PROJECT_READ_USERS, ProjectPermission.PROJECT_READ_EVENTS]);
        onAdded();
      },
    }
  );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || permissions.length === 0) return;
    void addUser(trimmed, permissions);
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
                checked={permissions.includes(ProjectPermission.PROJECT_READ_USERS)}
                onChange={() => togglePermission(ProjectPermission.PROJECT_READ_USERS)}
                className="rounded border-gray-300"
              />
              <Eye className="size-4" />
              <span className="text-sm">Read Users</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={permissions.includes(ProjectPermission.PROJECT_READ_EVENTS)}
                onChange={() => togglePermission(ProjectPermission.PROJECT_READ_EVENTS)}
                className="rounded border-gray-300"
              />
              <History className="size-4" />
              <span className="text-sm">Read Events</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={permissions.includes(ProjectPermission.PROJECT_MANAGE_USERS)}
                onChange={() => togglePermission(ProjectPermission.PROJECT_MANAGE_USERS)}
                className="rounded border-gray-300"
              />
              <Shield className="size-4" />
              <span className="text-sm">Manage Users</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={permissions.includes(ProjectPermission.PROJECT_READ_API_KEY)}
                onChange={() => togglePermission(ProjectPermission.PROJECT_READ_API_KEY)}
                className="rounded border-gray-300"
              />
              <KeyRound className="size-4" />
              <span className="text-sm">Read API Key</span>
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
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const { mutate: removeUser, isLoading: removeLoading, error: removeError } = useRpcMutation(
    async () => {
      await authenticatedRpc.removeUserFromProject({
        projectId,
        userIdToRemove: user.userId,
      });
    },
    { onSuccess: onUpdated }
  );

  const { mutate: updatePermissions, isLoading: updateLoading, error: updateError } = useRpcMutation(
    async (newPermissions: ProjectPermission[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (authenticatedRpc.updateUserProjectPermissions as any)({
        projectId,
        userIdToUpdate: user.userId,
        permissions: newPermissions,
      });
    },
    { onSuccess: onUpdated }
  );

  const loading = removeLoading || updateLoading;
  const error = removeError || updateError || permissionError;

  const handleRemove = () => {
    if (!confirm(`Remove ${user.email} from this project?`)) return;
    void removeUser();
  };

  const togglePermission = (perm: ProjectPermission) => {
    setPermissionError(null);
    const newPermissions = user.permissions.includes(perm)
      ? user.permissions.filter((p) => p !== perm)
      : [...user.permissions, perm];

    if (newPermissions.length === 0) {
      setPermissionError("User must have at least one permission");
      return;
    }

    void updatePermissions(newPermissions);
  };

  return (
    <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
      <div className="flex-1">
        <div className="font-medium">{user.email}</div>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <label className="flex items-center gap-1 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={user.permissions.includes(ProjectPermission.PROJECT_READ_USERS)}
              onChange={() => togglePermission(ProjectPermission.PROJECT_READ_USERS)}
              disabled={loading}
              className="rounded border-gray-300"
            />
            <Eye className="size-3" />
            <span>Read Users</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={user.permissions.includes(ProjectPermission.PROJECT_READ_EVENTS)}
              onChange={() => togglePermission(ProjectPermission.PROJECT_READ_EVENTS)}
              disabled={loading}
              className="rounded border-gray-300"
            />
            <History className="size-3" />
            <span>Read Events</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={user.permissions.includes(ProjectPermission.PROJECT_MANAGE_USERS)}
              onChange={() => togglePermission(ProjectPermission.PROJECT_MANAGE_USERS)}
              disabled={loading}
              className="rounded border-gray-300"
            />
            <Shield className="size-3" />
            <span>Manage</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={user.permissions.includes(ProjectPermission.PROJECT_READ_API_KEY)}
              onChange={() => togglePermission(ProjectPermission.PROJECT_READ_API_KEY)}
              disabled={loading}
              className="rounded border-gray-300"
            />
            <KeyRound className="size-3" />
            <span>API Key</span>
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

type WebhookEventsResponse = {
  events: { id: string; projectId: string; type: string; data: unknown; receivedAt: string; actorEmail?: string }[];
  nextCursor: string | null;
  hasMore: boolean;
};

function parseWebhookEvents(result: WebhookEventsResponse): WebhookEvent[] {
  return result.events
    .filter((e) => e.type === EventType.WEBHOOK_RECEIVED)
    .map((e) => ({
      ...e,
      type: EventType.WEBHOOK_RECEIVED,
      data: e.data as WebhookEventData,
    }));
}

function WebhookEvents({ projectId }: { projectId: string }) {
  const { authenticatedRpc } = useAuth();
  const [showAll, setShowAll] = useState(false);
  const [additionalEvents, setAdditionalEvents] = useState<WebhookEvent[]>([]);

  const limit = showAll ? 20 : 3;
  const { data, isLoading: loading, error } = useRpc(
    () => authenticatedRpc.getEvents({
      projectId,
      type: EventType.WEBHOOK_RECEIVED,
      limit,
    }) as Promise<WebhookEventsResponse>,
    { deps: [authenticatedRpc, projectId, limit] }
  );

  const initialEvents = data ? parseWebhookEvents(data) : [];
  const events = [...initialEvents, ...additionalEvents];
  const cursor = additionalEvents.length > 0 ? null : data?.nextCursor ?? null;
  const hasMore = data?.hasMore ?? false;

  const { mutate: loadMore, isLoading: loadingMore, data: loadMoreData } = useRpcMutation(
    async (cursorId: string) => {
      const result = await authenticatedRpc.getEvents({
        projectId,
        type: EventType.WEBHOOK_RECEIVED,
        limit: 20,
        cursor: cursorId,
      }) as WebhookEventsResponse;
      return result;
    },
    {
      onSuccess: (result) => {
        const newEvents = parseWebhookEvents(result);
        setAdditionalEvents((prev) => [...prev, ...newEvents]);
      },
    }
  );

  // Track cursor and hasMore from loadMore results
  const currentCursor = loadMoreData?.nextCursor ?? cursor;
  const currentHasMore = loadMoreData ? loadMoreData.hasMore : hasMore;

  // Reset additional events when showAll changes
  const handleShowAll = () => {
    setAdditionalEvents([]);
    setShowAll(true);
  };

  const handleLoadMore = () => {
    if (currentCursor && currentHasMore) {
      void loadMore(currentCursor);
    }
  };

  const getMethodColor = (method: WebhookEventData["httpMethod"]) => {
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
                  <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-mono font-medium ${getMethodColor(event.data.httpMethod)}`}>
                    {event.data.httpMethod}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono truncate">{event.data.path}</code>
                    {event.data.queryString && (
                      <span className="text-xs text-muted-foreground truncate">?{event.data.queryString}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" />
                      {formatDate(event.receivedAt)}
                    </span>
                    {event.data.sourceIp && (
                      <span className="flex items-center gap-1">
                        <Globe className="size-3" />
                        {event.data.sourceIp}
                      </span>
                    )}
                    {event.data.body && (
                      <span className="flex items-center gap-1">
                        <FileJson className="size-3" />
                        {event.data.body.length} bytes
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
            
            {!showAll && hasMore && (
              <Button 
                variant="outline" 
                className="w-full"
                onClick={handleShowAll}
              >
                View all webhooks
                <ChevronRight className="size-4 ml-2" />
              </Button>
            )}
            
            {showAll && currentHasMore && (
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
            
            {showAll && !currentHasMore && events.length > 3 && (
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
  const { data: eventsResult, isLoading: loading, error } = useRpc(
    () =>
      authenticatedRpc.getEvents({ projectId, limit: 20 }) as Promise<{
        events: EventDto[];
        nextCursor: string | null;
        hasMore: boolean;
      }>,
    { deps: [authenticatedRpc, projectId] }
  );
  const events: ProjectActivityEvent[] = (eventsResult?.events ?? [])
    .filter((e) => e.type.startsWith("PROJECT_"))
    .map((e) => ({
      ...e,
      type: e.type as ProjectActivityEventType,
      data: e.data as ProjectActivityEventData,
    }));

  const getEventIcon = (eventType: ProjectActivityEvent["type"]) => {
    switch (eventType) {
      case "PROJECT_CREATED":
        return <FolderOpen className="size-4 text-green-500" />;
      case "PROJECT_USER_ADDED":
        return <UserPlus className="size-4 text-blue-500" />;
      case "PROJECT_USER_REMOVED":
        return <UserMinus className="size-4 text-red-500" />;
      case "PROJECT_USER_PERMISSION_GRANTED":
        return <KeyRound className="size-4 text-green-500" />;
      case "PROJECT_USER_PERMISSION_REVOKED":
        return <KeyRound className="size-4 text-orange-500" />;
      default:
        return <History className="size-4 text-muted-foreground" />;
    }
  };

  const getEventDescription = (event: ProjectActivityEvent) => {
    const targetEmail = event.data.targetEmail;
    const permission = event.data.permission;
    const permissionLabel =
      permission === "PROJECT_MANAGE_USERS" ? "Manage Users" :
      permission === "PROJECT_READ_EVENTS" ? "Read Events" :
      permission === "PROJECT_READ_API_KEY" ? "Read API Key" :
      "Read Users";
    
    switch (event.type) {
      case "PROJECT_CREATED":
        return <><span className="font-medium">{event.actorEmail}</span> created the project</>;
      case "PROJECT_USER_ADDED":
        return <><span className="font-medium">{event.actorEmail}</span> added <span className="font-medium">{targetEmail ?? "a user"}</span> to the project</>;
      case "PROJECT_USER_REMOVED":
        return <><span className="font-medium">{event.actorEmail}</span> removed <span className="font-medium">{targetEmail ?? "a user"}</span> from the project</>;
      case "PROJECT_USER_PERMISSION_GRANTED":
        return <><span className="font-medium">{event.actorEmail}</span> granted <span className="font-medium">{permissionLabel}</span> to <span className="font-medium">{targetEmail ?? "a user"}</span></>;
      case "PROJECT_USER_PERMISSION_REVOKED":
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
