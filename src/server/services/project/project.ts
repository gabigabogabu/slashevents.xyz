import type { SQL } from "bun";
import type { UUID } from "crypto";

import { ErrorCode } from "@/lib/errors";
import { RpcError } from "@/server/rpc-handler";
import * as queries from "@/server/db/queries";
import { ProjectPermission } from "@/server/db/queries/project";
import { EventType } from "@/server/db/queries/event";
import * as permissionsService from "./permissions";

export const createProject = async (
  { name, actorUserId }: { name: string, actorUserId: UUID },
  di: { db: SQL }
): Promise<{ projectId: UUID }> => {
  const { db } = di;

  // Verify user exists (JWT may be from a deleted user or old database)
  const user = await queries.getUserById(db, { id: actorUserId });
  if (!user) {
    throw new RpcError(ErrorCode.AUTHENTICATION_ERROR, 401, "User not found. Please sign in again.");
  }

  const projectId = await queries.insertProject(db, {
    name,
    created_by_user_id: actorUserId,
  });

  if (!projectId) {
    throw new RpcError(ErrorCode.INTERNAL_SERVER_ERROR, 500, "Failed to create project");
  }

  // Log project creation event
  await queries.insertProjectActivityEvent(db, {
    project_id: projectId,
    actor_user_id: actorUserId,
    event_type: EventType.PROJECT_CREATED,
    metadata: { name },
  });

  // Give creator full permissions (no permission check needed for project creator)
  await permissionsService.grantInitialPermissions({
    projectId,
    creatorUserId: actorUserId,
    permissions: [
      ProjectPermission.PROJECT_MANAGE_USERS,
      ProjectPermission.PROJECT_READ_USERS,
      ProjectPermission.PROJECT_READ_EVENTS,
      ProjectPermission.PROJECT_READ_API_KEY,
    ],
  }, di);

  return { projectId };
};

export const getProjects = async (
  { actorUserId }: { actorUserId: UUID },
  { db }: { db: SQL }
): Promise<{ projects: { id: UUID; name: string; createdAt: string }[] }> => {
  const projects = await queries.getProjectsByUserId(db, { user_id: actorUserId });
  return {
    projects: projects.map((p) => ({ ...p, createdAt: p.created_at })),
  };
};

export const getProject = async (
  { projectId, actorUserId }: { projectId: UUID; actorUserId: UUID },
  { db }: { db: SQL }
): Promise<{ project: { id: UUID; name: string; createdAt: string } }> => {
  const hasAccess = await queries.checkUserHasAnyProjectPermission(db, {
    project_id: projectId,
    user_id: actorUserId,
  });

  if (!hasAccess)
    throw new RpcError(ErrorCode.PROJECT_NOT_FOUND, 404);

  const project = await queries.getProjectById(db, { id: projectId });
  if (!project)
    throw new RpcError(ErrorCode.PROJECT_NOT_FOUND, 404);

  return {
    project: {
      id: project.id,
      name: project.name,
      createdAt: project.created_at,
    },
  };
};

export const getProjectUsers = async (
  { projectId, actorUserId }: { projectId: UUID; actorUserId: UUID },
  { db }: { db: SQL }
): Promise<{
  users: { userId: UUID; email: string; permissions: ProjectPermission[] }[];
}> => {
  const hasAccess = await queries.checkUserHasProjectPermission(db, {
    project_id: projectId,
    user_id: actorUserId,
    permission: ProjectPermission.PROJECT_READ_USERS,
  });

  if (!hasAccess) {
    throw new RpcError(ErrorCode.PROJECT_NOT_FOUND, 404);
  }

  const users = await queries.getProjectUsers(db, { project_id: projectId });
  return {
    users: users.map((u) => ({
      userId: u.user_id,
      email: u.email,
      permissions: u.permissions,
    })),
  };
};

export const addUserToProject = async (
  {
    projectId,
    userEmail,
    permissions,
    actorUserId,
  }: { projectId: UUID; userEmail: string; permissions: ProjectPermission[], actorUserId: UUID },
  di: { db: SQL }
): Promise<void> => {
  const { db } = di;
  // Find the user to add by email
  const userToAdd = await queries.getUserByEmail(db, { email: userEmail });
  if (!userToAdd) {
    throw new RpcError(ErrorCode.USER_NOT_FOUND, 404);
  }

  // Add user to project (checks permissions, grants permissions, logs events)
  await permissionsService.addUserToProject({
    projectId,
    userId: userToAdd.id as UUID,
    permissions,
    actorUserId,
  }, di);
};

export const removeUserFromProject = async (
  { projectId, userIdToRemove, actorUserId }: { projectId: UUID; userIdToRemove: UUID; actorUserId: UUID },
  di: { db: SQL }
): Promise<void> => {
  const { db } = di;
  // Remove user from project (checks permissions, removes all permissions, logs events)
  const { removed } = await permissionsService.removeUserFromProject({
    projectId,
    userId: userIdToRemove,
    actorUserId,
  }, di);

  if (!removed)
    throw new RpcError(ErrorCode.USER_NOT_FOUND, 404, "User not found in project");
};

export const updateUserProjectPermissions = async (
  {
    projectId,
    userIdToUpdate,
    permissions,
    actorUserId,
  }: { projectId: UUID; userIdToUpdate: UUID; permissions: ProjectPermission[]; actorUserId: UUID },
  di: { db: SQL }
): Promise<void> => {
  // Sync permissions (checks actor has manage permission, prevents self-revoke, and logs events)
  await permissionsService.syncPermissions({
    projectId,
    userId: userIdToUpdate,
    permissions,
    actorUserId,
  }, di);
};
