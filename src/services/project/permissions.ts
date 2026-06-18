import type { SQL } from "@/db/types";
import type { UUID } from "crypto";

import { ErrorCode } from "@/lib/errors";
import { AppError } from "@/lib/app-error";
import * as queries from "@/db/queries";
import { ProjectPermission } from "@/lib/project-permissions";
import { EventType } from "@/lib/event-types";

/**
 * Check if the actor has permission to manage users in the project.
 * Throws PROJECT_NOT_FOUND if they don't (to avoid revealing project existence).
 */
const assertCanManageUsers = async (
  params: {
    projectId: UUID;
    actorUserId: UUID;
  },
  di: { db: SQL }
): Promise<void> => {
  const { db } = di;
  const hasPermission = await queries.checkUserHasProjectPermission(db, {
    project_id: params.projectId,
    user_id: params.actorUserId,
    permission: ProjectPermission.PROJECT_MANAGE_USERS,
  });

  if (!hasPermission)
    throw new AppError(ErrorCode.PROJECT_NOT_FOUND, 404);
};

/**
 * Internal: Grant a permission without checking actor permissions.
 * Used after permission has already been verified.
 */
const grantPermissionUnchecked = async (
  params: {
    projectId: UUID;
    userId: UUID;
    userDisplayName?: string;
    permission: ProjectPermission;
    actorUserId: UUID;
  },
  di: { db: SQL }
): Promise<boolean> => {
  const { db } = di;
  try {
    await queries.allowProjectUserPermission(db, {
      project_id: params.projectId,
      user_id: params.userId,
      permission: params.permission,
    });

    let targetDisplayName = params.userDisplayName;
    if (!targetDisplayName) {
      const targetUser = await queries.getUserById(db, { id: params.userId });
      targetDisplayName = targetUser?.display_name;
    }

    await queries.insertProjectActivityEvent(db, {
      project_id: params.projectId,
      actor_user_id: params.actorUserId,
      event_type: EventType.PROJECT_USER_PERMISSION_GRANTED,
      metadata: {
        targetUserId: params.userId,
        targetDisplayName,
        permission: params.permission,
      },
    });

    return true;
  } catch (error) {
    // Ignore duplicate permission errors (unique constraint)
    if (
      error instanceof Error &&
      error.message.includes("duplicate key value")
    ) {
      return false;
    }
    throw error;
  }
};

/**
 * Grant a permission to a user on a project and log the event.
 * Requires the actor to have PROJECT_MANAGE_USERS permission.
 * Silently ignores if the permission already exists.
 */
export const grantPermission = async (
  params: {
    projectId: UUID;
    userId: UUID;
    permission: ProjectPermission;
    actorUserId: UUID;
  },
  di: { db: SQL }
): Promise<boolean> => {
  await assertCanManageUsers(params, di);
  return grantPermissionUnchecked(params, di);
};

/**
 * Internal: Revoke a permission without checking actor permissions.
 * Used after permission has already been verified.
 * Still checks for self-revoke of manage permission.
 */
const revokePermissionUnchecked = async (
  params: {
    projectId: UUID;
    userId: UUID;
    userDisplayName?: string;
    permission: ProjectPermission;
    actorUserId: UUID;
  },
  di: { db: SQL }
): Promise<boolean> => {
  const { db } = di;
  // Prevent users from revoking their own manage permission
  if (
    params.actorUserId === params.userId &&
    params.permission === ProjectPermission.PROJECT_MANAGE_USERS
  ) {
    throw new AppError(ErrorCode.BAD_REQUEST, 400, "Cannot revoke your own manage permission");
  }

  const revoked = await queries.revokeProjectUserPermission(db, {
    project_id: params.projectId,
    user_id: params.userId,
    permission: params.permission,
  });

  if (revoked) {
    let targetDisplayName = params.userDisplayName;
    if (!targetDisplayName) {
      const targetUser = await queries.getUserById(db, { id: params.userId });
      targetDisplayName = targetUser?.display_name;
    }

    await queries.insertProjectActivityEvent(db, {
      project_id: params.projectId,
      actor_user_id: params.actorUserId,
      event_type: EventType.PROJECT_USER_PERMISSION_REVOKED,
      metadata: {
        targetUserId: params.userId,
        targetDisplayName,
        permission: params.permission,
      },
    });
  }

  return revoked;
};

/**
 * Revoke a permission from a user on a project and log the event.
 * Requires the actor to have PROJECT_MANAGE_USERS permission.
 * Prevents users from revoking their own manage permission.
 * Returns true if the permission was revoked, false if it didn't exist.
 */
export const revokePermission = async (
  params: {
    projectId: UUID;
    userId: UUID;
    permission: ProjectPermission;
    actorUserId: UUID;
  },
  di: { db: SQL }
): Promise<boolean> => {
  await assertCanManageUsers(params, di);
  return revokePermissionUnchecked(params, di);
};

/**
 * Grant initial permissions to the project creator.
 * Does NOT check for existing permissions since the project was just created.
 * Should only be called during project creation.
 */
export const grantInitialPermissions = async (
  params: {
    projectId: UUID;
    creatorUserId: UUID;
    permissions: ProjectPermission[];
  },
  di: { db: SQL }
): Promise<ProjectPermission[]> => {
  const { db } = di;
  const granted: ProjectPermission[] = [];

  for (const permission of params.permissions) {
    const wasGranted = await grantPermissionUnchecked({
      projectId: params.projectId,
      userId: params.creatorUserId,
      permission,
      actorUserId: params.creatorUserId,
    }, di);
    if (wasGranted) {
      granted.push(permission);
    }
  }

  return granted;
};

/**
 * Grant multiple permissions to a user on a project.
 * Requires the actor to have PROJECT_MANAGE_USERS permission.
 * Returns the list of permissions that were newly granted.
 */
export const grantPermissions = async (
  params: {
    projectId: UUID;
    userId: UUID;
    permissions: ProjectPermission[];
    actorUserId: UUID;
  },
  di: { db: SQL }
): Promise<ProjectPermission[]> => {
  // Check permission once upfront
  await assertCanManageUsers(params, di);

  const granted: ProjectPermission[] = [];

  for (const permission of params.permissions) {
    const wasGranted = await grantPermissionUnchecked({
      projectId: params.projectId,
      userId: params.userId,
      permission,
      actorUserId: params.actorUserId,
    }, di);
    if (wasGranted) {
      granted.push(permission);
    }
  }

  return granted;
};

/**
 * Sync a user's permissions to the desired set.
 * Requires the actor to have PROJECT_MANAGE_USERS permission.
 * Grants new permissions and revokes removed ones.
 * Returns the changes made.
 */
export const syncPermissions = async (
  params: {
    projectId: UUID;
    userId: UUID;
    permissions: ProjectPermission[];
    actorUserId: UUID;
  },
  di: { db: SQL }
): Promise<{ granted: ProjectPermission[]; revoked: ProjectPermission[] }> => {
  const { db } = di;
  await assertCanManageUsers(params, di);

  const targetUser = await queries.getUserById(db, { id: params.userId });
  const targetDisplayName = targetUser?.display_name;

  const currentPermissions = await queries.getProjectUserPermissions(db, {
    project_id: params.projectId,
    user_id: params.userId,
  });

  const permissionsToRevoke = currentPermissions.filter((perm) => !params.permissions.includes(perm));
  const permissionsToGrant = params.permissions.filter((perm) => !currentPermissions.includes(perm));

  const revoked = await Promise.all(permissionsToRevoke.map(async (perm) => {
    await revokePermissionUnchecked({
      projectId: params.projectId,
      userId: params.userId,
      userDisplayName: targetDisplayName,
      permission: perm,
      actorUserId: params.actorUserId,
    }, di)
    return perm;
  }));

  const granted = await Promise.all(permissionsToGrant.map(async (perm) => {
    await grantPermissionUnchecked({
      projectId: params.projectId,
      userId: params.userId,
      userDisplayName: targetDisplayName,
      permission: perm,
      actorUserId: params.actorUserId,
    }, di)
    return perm;
  }));

  return { granted, revoked };
};

/**
 * Add a user to a project with the specified permissions.
 * Requires the actor to have PROJECT_MANAGE_USERS permission.
 * Logs USER_ADDED event for new users, plus individual PERMISSION_GRANTED events.
 */
export const addUserToProject = async (
  params: {
    projectId: UUID;
    userId: UUID;
    userDisplayName?: string;
    permissions: ProjectPermission[];
    actorUserId: UUID;
  },
  di: { db: SQL }
): Promise<{ isNewUser: boolean; granted: ProjectPermission[] }> => {
  const { db } = di;
  // Check permission once upfront
  await assertCanManageUsers(params, di);

  let targetDisplayName = params.userDisplayName;
  if (!targetDisplayName) {
    const targetUser = await queries.getUserById(db, { id: params.userId });
    targetDisplayName = targetUser?.display_name;
  }

  // Check if user is already in project
  const existingPermissions = await queries.getProjectUserPermissions(db, {
    project_id: params.projectId,
    user_id: params.userId,
  });
  const isNewUser = existingPermissions.length === 0;

  // Grant permissions (pass display name to avoid duplicate lookups)
  const granted: ProjectPermission[] = [];
  for (const permission of params.permissions) {
    const wasGranted = await grantPermissionUnchecked({
      projectId: params.projectId,
      userId: params.userId,
      userDisplayName: targetDisplayName,
      permission,
      actorUserId: params.actorUserId,
    }, di);
    if (wasGranted) {
      granted.push(permission);
    }
  }

  // Log USER_ADDED event for new users
  if (isNewUser && granted.length > 0) {
    await queries.insertProjectActivityEvent(db, {
      project_id: params.projectId,
      actor_user_id: params.actorUserId,
      event_type: EventType.PROJECT_USER_ADDED,
      metadata: {
        targetUserId: params.userId,
        targetDisplayName,
        permissions: granted,
      },
    });
  }

  return { isNewUser, granted };
};

/**
 * Remove a user from a project by revoking all their permissions.
 * Requires the actor to have PROJECT_MANAGE_USERS permission.
 * Prevents users from removing themselves.
 * Logs USER_REMOVED event.
 */
export const removeUserFromProject = async (
  params: {
    projectId: UUID;
    userId: UUID;
    actorUserId: UUID;
  },
  di: { db: SQL }
): Promise<{ removed: boolean; removedPermissions: ProjectPermission[] }> => {
  const { db } = di;
  // Check permission
  await assertCanManageUsers(params, di);

  // Prevent removing yourself
  if (params.actorUserId === params.userId)
    throw new AppError(ErrorCode.BAD_REQUEST, 400, "Cannot remove yourself from the project");

  const targetUser = await queries.getUserById(db, { id: params.userId });
  const targetDisplayName = targetUser?.display_name;

  // Get permissions before removing for logging
  const removedPermissions = await queries.getProjectUserPermissions(db, {
    project_id: params.projectId,
    user_id: params.userId,
  });

  const removedCount = await queries.deleteAllProjectUserPermissions(db, {
    project_id: params.projectId,
    user_id: params.userId,
  });

  if (removedCount === 0)
    return { removed: false, removedPermissions: [] };

  // Log USER_REMOVED event
  await queries.insertProjectActivityEvent(db, {
    project_id: params.projectId,
    actor_user_id: params.actorUserId,
      event_type: EventType.PROJECT_USER_REMOVED,
    metadata: {
      targetUserId: params.userId,
      targetDisplayName,
      removedPermissions,
    },
  });

  return { removed: true, removedPermissions };
};
