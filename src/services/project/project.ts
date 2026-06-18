import type { SQL } from "@/db/types";
import type { UUID } from "crypto";

import { ErrorCode } from "@/lib/errors";
import { AppError } from "@/lib/app-error";
import * as queries from "@/db/queries";
import { timestampToIsoString } from "@/db/timestamps";
import { ProjectPermission } from "@/lib/project-permissions";
import * as permissionsService from "./permissions";
import { EventType } from "@/lib/event-types";

export const createProject = async (
  { name, actorUserId }: { name: string, actorUserId: UUID },
  di: { db: SQL }
): Promise<{ projectId: UUID }> => {
  const { db } = di;

  const user = await queries.getUserById(db, { id: actorUserId });
  if (!user) {
    throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 401, "User not found. Please sign in again.");
  }

  const projectId = await queries.insertProject(db, {
    name,
    created_by_user_id: actorUserId,
  });

  if (!projectId) {
    throw new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 500, "Failed to create project");
  }

  await queries.insertProjectActivityEvent(db, {
    project_id: projectId,
    actor_user_id: actorUserId,
    event_type: EventType.PROJECT_CREATED,
    metadata: { name },
  });

  await permissionsService.grantInitialPermissions({
    projectId,
    creatorUserId: actorUserId,
    permissions: [
      ProjectPermission.PROJECT_MANAGE_USERS,
      ProjectPermission.PROJECT_READ_USERS,
      ProjectPermission.PROJECT_READ_EVENTS,
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
    projects: projects.map((p) => ({ ...p, createdAt: timestampToIsoString(p.created_at) })),
  };
};

export const getProject = async (
  { projectId, actorUserId }: { projectId: UUID; actorUserId: UUID },
  { db }: { db: SQL }
): Promise<{ project: { id: UUID; name: string; webhookPathAllowlist: string[]; createdAt: string } }> => {
  const hasAccess = await queries.checkUserHasAnyProjectPermission(db, {
    project_id: projectId,
    user_id: actorUserId,
  });

  if (!hasAccess)
    throw new AppError(ErrorCode.PROJECT_NOT_FOUND, 404);

  const project = await queries.getProjectById(db, { id: projectId });
  if (!project)
    throw new AppError(ErrorCode.PROJECT_NOT_FOUND, 404);

  return {
    project: {
      id: project.id,
      name: project.name,
      webhookPathAllowlist: project.webhook_path_allowlist,
      createdAt: timestampToIsoString(project.created_at),
    },
  };
};

export const setProjectWebhookPathAllowlist = async (
  { projectId, paths, actorUserId }: { projectId: UUID; paths: string[]; actorUserId: UUID },
  { db }: { db: SQL }
): Promise<{ webhookPathAllowlist: string[] }> => {
  const hasAccess = await queries.checkUserHasProjectPermission(db, {
    project_id: projectId,
    user_id: actorUserId,
    permission: ProjectPermission.PROJECT_MANAGE_USERS,
  });

  if (!hasAccess)
    throw new AppError(ErrorCode.PROJECT_NOT_FOUND, 404);

  const updated = await queries.updateProjectWebhookPathAllowlist(db, {
    project_id: projectId,
    webhook_path_allowlist: paths,
  });
  if (!updated)
    throw new AppError(ErrorCode.PROJECT_NOT_FOUND, 404);

  return { webhookPathAllowlist: paths };
};

export const getProjectUsers = async (
  { projectId, actorUserId }: { projectId: UUID; actorUserId: UUID },
  { db }: { db: SQL }
): Promise<{
  users: { userId: UUID; displayName: string; permissions: ProjectPermission[] }[];
}> => {
  const hasAccess = await queries.checkUserHasProjectPermission(db, {
    project_id: projectId,
    user_id: actorUserId,
    permission: ProjectPermission.PROJECT_READ_USERS,
  });

  if (!hasAccess) {
    throw new AppError(ErrorCode.PROJECT_NOT_FOUND, 404);
  }

  const users = await queries.getProjectUsers(db, { project_id: projectId });
  return {
    users: users.map((u) => ({
      userId: u.user_id,
      displayName: u.display_name,
      permissions: u.permissions,
    })),
  };
};

export const addUserToProject = async (
  {
    projectId,
    userIdToAdd,
    permissions,
    actorUserId,
  }: { projectId: UUID; userIdToAdd: UUID; permissions: ProjectPermission[], actorUserId: UUID },
  di: { db: SQL }
): Promise<void> => {
  const { db } = di;
  const userToAdd = await queries.getUserById(db, { id: userIdToAdd });
  if (!userToAdd) {
    throw new AppError(ErrorCode.USER_NOT_FOUND, 404);
  }

  await permissionsService.addUserToProject({
    projectId,
    userId: userToAdd.id,
    permissions,
    actorUserId,
  }, di);
};

export const removeUserFromProject = async (
  { projectId, userIdToRemove, actorUserId }: { projectId: UUID; userIdToRemove: UUID; actorUserId: UUID },
  di: { db: SQL }
): Promise<void> => {
  const { db } = di;
  const { removed } = await permissionsService.removeUserFromProject({
    projectId,
    userId: userIdToRemove,
    actorUserId,
  }, di);

  if (!removed)
    throw new AppError(ErrorCode.USER_NOT_FOUND, 404, "User not found in project");
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
  await permissionsService.syncPermissions({
    projectId,
    userId: userIdToUpdate,
    permissions,
    actorUserId,
  }, di);
};
