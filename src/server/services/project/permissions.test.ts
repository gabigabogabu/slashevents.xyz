import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { SQL } from "bun";
import type { UUID } from "crypto";
import { getTestDb, resetTestDb } from "@/server/db/test-setup";
import { ErrorCode } from "@/lib/errors";
import * as queries from "@/server/db/queries";
import { ProjectPermission } from "@/server/db/queries/project";
import { EventType } from "@/server/db/queries/event";
import * as permissionsService from "./permissions";

describe("permissions service", () => {
  let db: SQL;
  let adminUserId: UUID;
  let regularUserId: UUID;
  let noPermissionUserId: UUID;
  let projectId: UUID;

  beforeAll(async () => {
    db = getTestDb();
    await resetTestDb(db);

    // Create test users
    adminUserId = (await queries.insertUser(db, {
      email: `admin-${Date.now()}@example.com`,
      password_hash: "testhash123",
      password_salt: "testsalt123",
    })) as UUID;

    regularUserId = (await queries.insertUser(db, {
      email: `regular-${Date.now()}@example.com`,
      password_hash: "testhash123",
      password_salt: "testsalt123",
    })) as UUID;

    noPermissionUserId = (await queries.insertUser(db, {
      email: `noperm-${Date.now()}@example.com`,
      password_hash: "testhash123",
      password_salt: "testsalt123",
    })) as UUID;

    // Create a test project
    projectId = (await queries.insertProject(db, {
      name: "Test Project",
      created_by_user_id: adminUserId,
    })) as UUID;

    // Give admin user manage permission
    await queries.allowProjectUserPermission(db, {
      project_id: projectId,
      user_id: adminUserId,
      permission: ProjectPermission.PROJECT_MANAGE_USERS,
    });
    await queries.allowProjectUserPermission(db, {
      project_id: projectId,
      user_id: adminUserId,
      permission: ProjectPermission.PROJECT_READ_USERS,
    });
  });

  afterAll(async () => {
    await db.close();
  });

  describe("grantPermission", () => {
    test("grants permission when actor has manage permission", async () => {
      const granted = await permissionsService.grantPermission({
        projectId,
        userId: regularUserId,
        permission: ProjectPermission.PROJECT_READ_USERS,
        actorUserId: adminUserId,
      }, { db });

      expect(granted).toBe(true);

      const permissions = await queries.getProjectUserPermissions(db, {
        project_id: projectId,
        user_id: regularUserId,
      });
      expect(permissions).toContain(ProjectPermission.PROJECT_READ_USERS);
    });

    test("logs PERMISSION_GRANTED event with metadata", async () => {
      const events = await queries.getProjectActivityEvents(db, { project_id: projectId });
      const grantEvent = events.find(
        (e) =>
          e.type === EventType.PROJECT_USER_PERMISSION_GRANTED &&
          e.data.targetUserId === regularUserId &&
          e.data.permission === ProjectPermission.PROJECT_READ_USERS
      );
      expect(grantEvent).toBeDefined();
      expect(grantEvent?.data.targetEmail).toBeDefined();
    });

    test("returns false for duplicate permission", async () => {
      const granted = await permissionsService.grantPermission({
        projectId,
        userId: regularUserId,
        permission: ProjectPermission.PROJECT_READ_USERS,
        actorUserId: adminUserId,
      }, { db });

      expect(granted).toBe(false);
    });

    test("throws PROJECT_NOT_FOUND when actor lacks manage permission", async () => {
      expect(
        permissionsService.grantPermission({
          projectId,
          userId: noPermissionUserId,
          permission: ProjectPermission.PROJECT_READ_USERS,
          actorUserId: regularUserId, // regularUser only has read permission
        }, { db })
      ).rejects.toThrow(ErrorCode.PROJECT_NOT_FOUND);
    });
  });

  describe("revokePermission", () => {
    test("revokes permission when actor has manage permission", async () => {
      // First grant a permission to revoke
      await queries.allowProjectUserPermission(db, {
        project_id: projectId,
        user_id: regularUserId,
        permission: ProjectPermission.PROJECT_MANAGE_USERS,
      });

      const revoked = await permissionsService.revokePermission({
        projectId,
        userId: regularUserId,
        permission: ProjectPermission.PROJECT_MANAGE_USERS,
        actorUserId: adminUserId,
      }, { db });

      expect(revoked).toBe(true);

      const permissions = await queries.getProjectUserPermissions(db, {
        project_id: projectId,
        user_id: regularUserId,
      });
      expect(permissions).not.toContain(ProjectPermission.PROJECT_MANAGE_USERS);
    });

    test("logs PERMISSION_REVOKED event with metadata", async () => {
      const events = await queries.getProjectActivityEvents(db, { project_id: projectId });
      const revokeEvent = events.find(
        (e) =>
          e.type === EventType.PROJECT_USER_PERMISSION_REVOKED &&
          e.data.targetUserId === regularUserId &&
          e.data.permission === ProjectPermission.PROJECT_MANAGE_USERS
      );
      expect(revokeEvent).toBeDefined();
      expect(revokeEvent?.data.targetEmail).toBeDefined();
    });

    test("returns false for non-existent permission", async () => {
      const revoked = await permissionsService.revokePermission({
        projectId,
        userId: noPermissionUserId,
        permission: ProjectPermission.PROJECT_READ_USERS,
        actorUserId: adminUserId,
      }, { db });

      expect(revoked).toBe(false);
    });

    test("throws PROJECT_NOT_FOUND when actor lacks manage permission", async () => {
      expect(
        permissionsService.revokePermission({
          projectId,
          userId: adminUserId,
          permission: ProjectPermission.PROJECT_READ_USERS,
          actorUserId: regularUserId,
        }, { db })
      ).rejects.toThrow(ErrorCode.PROJECT_NOT_FOUND);
    });

    test("throws when trying to revoke own manage permission", async () => {
      expect(
        permissionsService.revokePermission({
          projectId,
          userId: adminUserId,
          permission: ProjectPermission.PROJECT_MANAGE_USERS,
          actorUserId: adminUserId,
        }, { db })
      ).rejects.toThrow(ErrorCode.BAD_REQUEST);
    });
  });

  describe("grantInitialPermissions", () => {
    test("grants permissions without checking actor permissions", async () => {
      // Create a new project for this test
      const newProjectId = (await queries.insertProject(db, {
        name: "New Project",
        created_by_user_id: noPermissionUserId,
      })) as UUID;

      // noPermissionUserId has no permissions yet, but can grant initial permissions
      const granted = await permissionsService.grantInitialPermissions({
        projectId: newProjectId,
        creatorUserId: noPermissionUserId,
        permissions: [ProjectPermission.PROJECT_MANAGE_USERS, ProjectPermission.PROJECT_READ_USERS, ProjectPermission.PROJECT_READ_EVENTS],
      }, { db });

      expect(granted).toContain(ProjectPermission.PROJECT_MANAGE_USERS);
      expect(granted).toContain(ProjectPermission.PROJECT_READ_USERS);
      expect(granted).toContain(ProjectPermission.PROJECT_READ_EVENTS);

      const permissions = await queries.getProjectUserPermissions(db, {
        project_id: newProjectId,
        user_id: noPermissionUserId,
      });
      expect(permissions.length).toBe(3);
    });
  });

  describe("syncPermissions", () => {
    let syncTestProjectId: UUID;
    let syncTestUserId: UUID;

    beforeAll(async () => {
      // Create a separate project for sync tests
      syncTestProjectId = (await queries.insertProject(db, {
        name: "Sync Test Project",
        created_by_user_id: adminUserId,
      })) as UUID;

      syncTestUserId = (await queries.insertUser(db, {
        email: `synctest-${Date.now()}@example.com`,
        password_hash: "testhash123",
        password_salt: "testsalt123",
      })) as UUID;

      // Give admin manage permission on this project
      await queries.allowProjectUserPermission(db, {
        project_id: syncTestProjectId,
        user_id: adminUserId,
        permission: ProjectPermission.PROJECT_MANAGE_USERS,
      });

      // Give syncTestUser some initial permissions
      await queries.allowProjectUserPermission(db, {
        project_id: syncTestProjectId,
        user_id: syncTestUserId,
        permission: ProjectPermission.PROJECT_READ_USERS,
      });
    });

    test("adds new permissions and removes old ones", async () => {
      const result = await permissionsService.syncPermissions({
        projectId: syncTestProjectId,
        userId: syncTestUserId,
        permissions: [ProjectPermission.PROJECT_MANAGE_USERS], // Remove read, add manage
        actorUserId: adminUserId,
      }, { db });

      expect(result.granted).toContain(ProjectPermission.PROJECT_MANAGE_USERS);
      expect(result.revoked).toContain(ProjectPermission.PROJECT_READ_USERS);

      const permissions = await queries.getProjectUserPermissions(db, {
        project_id: syncTestProjectId,
        user_id: syncTestUserId,
      });
      expect(permissions).toContain(ProjectPermission.PROJECT_MANAGE_USERS);
      expect(permissions).not.toContain(ProjectPermission.PROJECT_READ_USERS);
    });

    test("throws PROJECT_NOT_FOUND when actor lacks manage permission", async () => {
      expect(
        permissionsService.syncPermissions({
          projectId: syncTestProjectId,
          userId: syncTestUserId,
          permissions: [ProjectPermission.PROJECT_READ_USERS],
          actorUserId: regularUserId,
        }, { db })
      ).rejects.toThrow(ErrorCode.PROJECT_NOT_FOUND);
    });
  });

  describe("addUserToProject", () => {
    let addUserTestProjectId: UUID;
    let newUserId: UUID;

    beforeAll(async () => {
      addUserTestProjectId = (await queries.insertProject(db, {
        name: "Add User Test Project",
        created_by_user_id: adminUserId,
      })) as UUID;

      newUserId = (await queries.insertUser(db, {
        email: `newuser-${Date.now()}@example.com`,
        password_hash: "testhash123",
        password_salt: "testsalt123",
      })) as UUID;

      await queries.allowProjectUserPermission(db, {
        project_id: addUserTestProjectId,
        user_id: adminUserId,
        permission: ProjectPermission.PROJECT_MANAGE_USERS,
      });
    });

    test("adds new user with permissions and logs USER_ADDED event", async () => {
      const result = await permissionsService.addUserToProject({
        projectId: addUserTestProjectId,
        userId: newUserId,
        permissions: [ProjectPermission.PROJECT_READ_USERS],
        actorUserId: adminUserId,
      }, { db });

      expect(result.isNewUser).toBe(true);
      expect(result.granted).toContain(ProjectPermission.PROJECT_READ_USERS);

      // Check USER_ADDED event was logged with metadata
      const events = await queries.getProjectActivityEvents(db, { project_id: addUserTestProjectId });
      const addedEvent = events.find(
        (e) => e.type === EventType.PROJECT_USER_ADDED && e.data.targetUserId === newUserId
      );
      expect(addedEvent).toBeDefined();
      expect(addedEvent?.data.targetEmail).toBeDefined();
      expect(addedEvent?.data.permissions).toContain(ProjectPermission.PROJECT_READ_USERS);
    });

    test("does not log USER_ADDED event for existing user", async () => {
      const eventsBefore = await queries.getProjectActivityEvents(db, { project_id: addUserTestProjectId });
      const userAddedCountBefore = eventsBefore.filter(
        (e) => e.type === EventType.PROJECT_USER_ADDED
      ).length;

      // Add another permission to existing user
      const result = await permissionsService.addUserToProject({
        projectId: addUserTestProjectId,
        userId: newUserId,
        permissions: [ProjectPermission.PROJECT_MANAGE_USERS],
        actorUserId: adminUserId,
      }, { db });

      expect(result.isNewUser).toBe(false);

      const eventsAfter = await queries.getProjectActivityEvents(db, { project_id: addUserTestProjectId });
      const userAddedCountAfter = eventsAfter.filter(
        (e) => e.type === EventType.PROJECT_USER_ADDED
      ).length;

      expect(userAddedCountAfter).toBe(userAddedCountBefore);
    });

    test("throws PROJECT_NOT_FOUND when actor lacks manage permission", async () => {
      expect(
        permissionsService.addUserToProject({
          projectId: addUserTestProjectId,
          userId: noPermissionUserId,
          permissions: [ProjectPermission.PROJECT_READ_USERS],
          actorUserId: regularUserId,
        }, { db })
      ).rejects.toThrow(ErrorCode.PROJECT_NOT_FOUND);
    });
  });

  describe("removeUserFromProject", () => {
    let removeUserTestProjectId: UUID;
    let userToRemoveId: UUID;

    beforeAll(async () => {
      removeUserTestProjectId = (await queries.insertProject(db, {
        name: "Remove User Test Project",
        created_by_user_id: adminUserId,
      })) as UUID;

      userToRemoveId = (await queries.insertUser(db, {
        email: `toremove-${Date.now()}@example.com`,
        password_hash: "testhash123",
        password_salt: "testsalt123",
      })) as UUID;

      await queries.allowProjectUserPermission(db, {
        project_id: removeUserTestProjectId,
        user_id: adminUserId,
        permission: ProjectPermission.PROJECT_MANAGE_USERS,
      });

      await queries.allowProjectUserPermission(db, {
        project_id: removeUserTestProjectId,
        user_id: userToRemoveId,
        permission: ProjectPermission.PROJECT_READ_USERS,
      });
      await queries.allowProjectUserPermission(db, {
        project_id: removeUserTestProjectId,
        user_id: userToRemoveId,
        permission: ProjectPermission.PROJECT_MANAGE_USERS,
      });
    });

    test("removes user and all their permissions", async () => {
      const result = await permissionsService.removeUserFromProject({
        projectId: removeUserTestProjectId,
        userId: userToRemoveId,
        actorUserId: adminUserId,
      }, { db });

      expect(result.removed).toBe(true);
      expect(result.removedPermissions.length).toBe(2);

      const permissions = await queries.getProjectUserPermissions(db, {
        project_id: removeUserTestProjectId,
        user_id: userToRemoveId,
      });
      expect(permissions.length).toBe(0);
    });

    test("logs USER_REMOVED event with metadata", async () => {
      const events = await queries.getProjectActivityEvents(db, { project_id: removeUserTestProjectId });
      const removedEvent = events.find(
        (e) => e.type === EventType.PROJECT_USER_REMOVED && e.data.targetUserId === userToRemoveId
      );
      expect(removedEvent).toBeDefined();
      expect(removedEvent?.data.targetEmail).toBeDefined();
      expect(removedEvent?.data.removedPermissions).toBeDefined();
    });

    test("returns removed: false for user not in project", async () => {
      const result = await permissionsService.removeUserFromProject({
        projectId: removeUserTestProjectId,
        userId: noPermissionUserId,
        actorUserId: adminUserId,
      }, { db });

      expect(result.removed).toBe(false);
    });

    test("throws when trying to remove yourself", async () => {
      expect(
        permissionsService.removeUserFromProject({
          projectId: removeUserTestProjectId,
          userId: adminUserId,
          actorUserId: adminUserId,
        }, { db })
      ).rejects.toThrow(ErrorCode.BAD_REQUEST);
    });

    test("throws PROJECT_NOT_FOUND when actor lacks manage permission", async () => {
      expect(
        permissionsService.removeUserFromProject({
          projectId: removeUserTestProjectId,
          userId: adminUserId,
          actorUserId: regularUserId,
        }, { db })
      ).rejects.toThrow(ErrorCode.PROJECT_NOT_FOUND);
    });
  });
});

