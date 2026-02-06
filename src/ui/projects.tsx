import { useState, type FormEvent } from "react";
import { useAuth } from "@/ui/auth-context";
import { useRpc, useRpcMutation } from "@/ui/use-rpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EventType } from "@/lib/event-types";
import { Copy, EyeOff, Trash2, FolderOpen, Loader2, UserPlus, Shield, Eye, History, UserMinus, KeyRound, ChevronRight, Globe, Clock, FileJson } from "lucide-react";
import { ProjectPermission } from "@/lib/project-permissions";
import type { ProjectTab } from "@/ui/app";

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

type WebhookEventData = {
  httpMethod: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  path: string;
  headers: Record<string, string>;
  body: string | null;
  queryString: string | null;
  sourceIp: string | null;
  sourcePort: number | null;
};



export function ProjectDetailPage({ projectId, tab }: { projectId: string; tab: ProjectTab }) {
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
      <p className="text-sm text-destructive p-4">{error ?? "Project not found"}</p>
    );
  }

  return <ProjectDetail project={project} tab={tab} />;
}

function ProjectDetail({ project, tab }: { project: Project; tab: ProjectTab }) {
  return (
    <div>
      {tab === "overview" && <OverviewTab project={project} />}
      {tab === "users" && <UsersTab projectId={project.id} />}
      {tab === "events" && <EventsTab projectId={project.id} />}
    </div>
  );
}

function OverviewTab({ project }: { project: Project }) {
  const { authenticatedRpc } = useAuth();
  const [showApiKey, setShowApiKey] = useState(false);

  const { data: apiKeyResult, isLoading: apiKeyLoading, error: apiKeyError } = useRpc(
    () => authenticatedRpc.getProjectApiKey({ projectId: project.id }) as Promise<{ apiKey: string }>,
    { deps: [authenticatedRpc, project.id] }
  );
  const apiKey = apiKeyResult?.apiKey ?? "";

  const copyApiKey = async () => {
    if (!apiKey) return;
    await navigator.clipboard.writeText(apiKey);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold mb-2">Webhook Endpoint</h2>
        <p className="text-sm text-muted-foreground mb-3">Send webhooks to this URL to capture them.</p>
        <code className="block bg-muted px-3 py-2 text-sm">/ingress/{project.id}/your-path</code>
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-2">API Key</h2>
        <p className="text-sm text-muted-foreground mb-3">Use this key to read events via the API.</p>
        <div className="flex items-center gap-2">
          <Input
            value={apiKey}
            readOnly
            type={showApiKey ? "text" : "password"}
            disabled={apiKeyLoading}
          />
          <Button variant="outline" onClick={() => setShowApiKey(!showApiKey)} disabled={apiKeyLoading}>
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
        {apiKeyError && <p className="mt-2 text-sm text-destructive">{apiKeyError}</p>}
      </div>

    </div>
  );
}

function UsersTab({ projectId }: { projectId: string }) {
  const { authenticatedRpc } = useAuth();
  const { data: usersResult, isLoading: loading, error, refetch: refetchUsers } = useRpc(
    () => authenticatedRpc.getProjectUsers({ projectId }) as Promise<{ users: ProjectUser[] }>,
    { deps: [authenticatedRpc, projectId] }
  );
  const users = usersResult?.users ?? [];

  return (
    <div className="space-y-6">
      <AddUserForm projectId={projectId} onAdded={refetchUsers} />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      ) : users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users found.</p>
      ) : (
        <div className="space-y-3">
          {users.map((user) => (
            <UserRow
              key={user.userId}
              user={user}
              projectId={projectId}
              onUpdated={refetchUsers}
            />
          ))}
        </div>
      )}
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
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex gap-2">
        <Label htmlFor="user-email" className="sr-only">User Email</Label>
        <Input
          id="user-email"
          type="email"
          placeholder="user@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
        />
        <Button type="submit" disabled={loading || !email.trim() || permissions.length === 0}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : "Add user"}
        </Button>
      </div>

      <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={permissions.includes(ProjectPermission.PROJECT_READ_USERS)}
            onChange={() => togglePermission(ProjectPermission.PROJECT_READ_USERS)}
            className="border-input"
          />
          <Eye className="size-3" />
          <span>Read Users</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={permissions.includes(ProjectPermission.PROJECT_READ_EVENTS)}
            onChange={() => togglePermission(ProjectPermission.PROJECT_READ_EVENTS)}
            className="border-input"
          />
          <History className="size-3" />
          <span>Read Events</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={permissions.includes(ProjectPermission.PROJECT_MANAGE_USERS)}
            onChange={() => togglePermission(ProjectPermission.PROJECT_MANAGE_USERS)}
            className="border-input"
          />
          <Shield className="size-3" />
          <span>Manage Users</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={permissions.includes(ProjectPermission.PROJECT_READ_API_KEY)}
            onChange={() => togglePermission(ProjectPermission.PROJECT_READ_API_KEY)}
            className="border-input"
          />
          <KeyRound className="size-3" />
          <span>Read API Key</span>
        </label>
      </div>

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </form>
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
    <div className="flex items-center justify-between p-3 border bg-card">
      <div className="flex-1">
        <div className="font-medium">{user.email}</div>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <label className="flex items-center gap-1 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={user.permissions.includes(ProjectPermission.PROJECT_READ_USERS)}
              onChange={() => togglePermission(ProjectPermission.PROJECT_READ_USERS)}
              disabled={loading}
              className="border-input"
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
              className="border-input"
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
              className="border-input"
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
              className="border-input"
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

type EventsResponse = {
  events: EventDto[];
  nextCursor: string | null;
  hasMore: boolean;
};

function EventsTab({ projectId }: { projectId: string }) {
  const { authenticatedRpc } = useAuth();
  const [additionalEvents, setAdditionalEvents] = useState<EventDto[]>([]);

  const limit = 20;
  const { data, isLoading: loading, error, refetch } = useRpc(
    () => authenticatedRpc.getEvents({
      projectId,
      limit,
    }) as Promise<EventsResponse>,
    { deps: [authenticatedRpc, projectId, limit] }
  );

  const initialEvents = data?.events ?? [];
  const events = [...initialEvents, ...additionalEvents];
  const cursor = additionalEvents.length > 0 ? null : data?.nextCursor ?? null;
  const hasMore = data?.hasMore ?? false;

  const { mutate: loadMore, isLoading: loadingMore, data: loadMoreData } = useRpcMutation(
    async (cursorId: string) => {
      return await authenticatedRpc.getEvents({
        projectId,
        limit: 20,
        cursor: cursorId,
      }) as EventsResponse;
    },
    {
      onSuccess: (result) => {
        setAdditionalEvents((prev) => [...prev, ...result.events]);
      },
    }
  );

  const { mutate: sendTestEvent, isLoading: sendingTest } = useRpcMutation(
    async () => {
      await fetch(`/ingress/${projectId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true, timestamp: new Date().toISOString() }),
      });
    },
    {
      onSuccess: () => {
        setAdditionalEvents([]);
        refetch();
      },
    }
  );

  const currentCursor = loadMoreData?.nextCursor ?? cursor;
  const currentHasMore = loadMoreData ? loadMoreData.hasMore : hasMore;

  const handleLoadMore = () => {
    if (currentCursor && currentHasMore) {
      void loadMore(currentCursor);
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
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button onClick={() => void sendTestEvent()} disabled={sendingTest}>
          {sendingTest ? <Loader2 className="size-4 animate-spin" /> : "Add test event"}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-4">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No events yet.</p>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <EventRow key={event.id} event={event} formatDate={formatDate} />
          ))}

          {currentHasMore && (
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

          {!currentHasMore && events.length > 0 && (
            <p className="text-xs text-muted-foreground text-center pt-2">
              Showing all {events.length} events
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function EventRow({ event, formatDate }: { event: EventDto; formatDate: (d: string) => string }) {
  if (event.type === EventType.WEBHOOK_RECEIVED) {
    return <WebhookEventRow event={event} formatDate={formatDate} />;
  }
  return <ActivityEventRow event={event} formatDate={formatDate} />;
}

function WebhookEventRow({ event, formatDate }: { event: EventDto; formatDate: (d: string) => string }) {
  const data = event.data as WebhookEventData;

  const getMethodColor = (method: string) => {
    switch (method) {
      case "GET": return "text-green-600 bg-green-100";
      case "POST": return "text-blue-600 bg-blue-100";
      case "PUT": return "text-yellow-600 bg-yellow-100";
      case "PATCH": return "text-orange-600 bg-orange-100";
      case "DELETE": return "text-red-600 bg-red-100";
      default: return "text-gray-600 bg-gray-100";
    }
  };

  return (
    <div className="flex items-start gap-3 p-3 border bg-card hover:bg-accent/50 transition-colors">
      <div className="flex-shrink-0">
        <span className={`inline-flex items-center px-2 py-1 text-xs font-mono font-medium ${getMethodColor(data.httpMethod)}`}>
          {data.httpMethod}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <code className="text-sm font-mono truncate">{data.path}</code>
          {data.queryString && (
            <span className="text-xs text-muted-foreground truncate">?{data.queryString}</span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {formatDate(event.receivedAt)}
          </span>
          {data.sourceIp && (
            <span className="flex items-center gap-1">
              <Globe className="size-3" />
              {data.sourceIp}
            </span>
          )}
          {data.body && (
            <span className="flex items-center gap-1">
              <FileJson className="size-3" />
              {data.body.length} bytes
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ActivityEventRow({ event, formatDate }: { event: EventDto; formatDate: (d: string) => string }) {
  const data = event.data as ProjectActivityEventData;
  const type = event.type as ProjectActivityEventType;

  const getEventIcon = () => {
    switch (type) {
      case "PROJECT_CREATED": return <FolderOpen className="size-4 text-green-500" />;
      case "PROJECT_USER_ADDED": return <UserPlus className="size-4 text-blue-500" />;
      case "PROJECT_USER_REMOVED": return <UserMinus className="size-4 text-red-500" />;
      case "PROJECT_USER_PERMISSION_GRANTED": return <KeyRound className="size-4 text-green-500" />;
      case "PROJECT_USER_PERMISSION_REVOKED": return <KeyRound className="size-4 text-orange-500" />;
      default: return <History className="size-4 text-muted-foreground" />;
    }
  };

  const getDescription = () => {
    const targetEmail = data.targetEmail;
    const permission = data.permission;
    const permissionLabel =
      permission === "PROJECT_MANAGE_USERS" ? "Manage Users" :
      permission === "PROJECT_READ_EVENTS" ? "Read Events" :
      permission === "PROJECT_READ_API_KEY" ? "Read API Key" :
      "Read Users";

    switch (type) {
      case "PROJECT_CREATED":
        return <><span className="font-medium">{event.actorEmail}</span> created the project</>;
      case "PROJECT_USER_ADDED":
        return <><span className="font-medium">{event.actorEmail}</span> added <span className="font-medium">{targetEmail ?? "a user"}</span></>;
      case "PROJECT_USER_REMOVED":
        return <><span className="font-medium">{event.actorEmail}</span> removed <span className="font-medium">{targetEmail ?? "a user"}</span></>;
      case "PROJECT_USER_PERMISSION_GRANTED":
        return <><span className="font-medium">{event.actorEmail}</span> granted <span className="font-medium">{permissionLabel}</span> to <span className="font-medium">{targetEmail ?? "a user"}</span></>;
      case "PROJECT_USER_PERMISSION_REVOKED":
        return <><span className="font-medium">{event.actorEmail}</span> revoked <span className="font-medium">{permissionLabel}</span> from <span className="font-medium">{targetEmail ?? "a user"}</span></>;
      default:
        return <span>Unknown event</span>;
    }
  };

  return (
    <div className="flex items-start gap-3 p-3 border bg-card">
      <div className="mt-0.5">{getEventIcon()}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm">{getDescription()}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{formatDate(event.receivedAt)}</div>
      </div>
    </div>
  );
}
