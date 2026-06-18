import { afterAll, beforeAll, describe, test } from "bun:test";

import { expect } from "@/test-expect";
import type { SQL } from "@/db/types";
import type { UUID } from "crypto";
import { getTestDb, resetTestDb } from "@/db/test-setup";
import { ErrorCode } from "@/lib/errors";
import * as queries from "@/db/queries";
import { ProjectPermission } from "@/lib/project-permissions";
import { EventType } from "@/lib/event-types";
import * as projectService from "./project";

describe("project service", () => {
  let db: SQL;
  let ownerUserId: UUID;
  let ownerDisplayName: string;
  let memberUserId: UUID;
  let memberDisplayName: string;
  let nonMemberUserId: UUID;

  beforeAll(async () => {
    db = getTestDb();
    await resetTestDb(db);

    // Create test users
    ownerDisplayName = `owner-${Date.now()}`;
    ownerUserId = (await queries.insertUser(db, {
      display_name: ownerDisplayName,
    })) as UUID;

    memberDisplayName = `member-${Date.now()}`;
    memberUserId = (await queries.insertUser(db, {
      display_name: memberDisplayName,
    })) as UUID;

    nonMemberUserId = (await queries.insertUser(db, {
      display_name: `nonmember-${Date.now()}`,
    })) as UUID;
  });

  afterAll(async () => {
    await db.end();
  });

  describe("createProject", () => {
    test("creates a project and returns the id", async () => {
      const result = await projectService.createProject(
        { name: "New Project", actorUserId: ownerUserId },
        { db }
      );

      expect(result.projectId).toBeDefined();
      expect(typeof result.projectId).toBe("string");
    });

    test("logs PROJECT_CREATED event", async () => {
      const result = await projectService.createProject(
        { name: "Event Test Project", actorUserId: ownerUserId },
        { db }
      );

      const events = await queries.getEvents(db, { project_id: result.projectId, type: EventType.PROJECT_CREATED });
      const createEvent = events.find((e) => e.type === EventType.PROJECT_CREATED);

      expect(createEvent).toBeDefined();
      expect((createEvent?.data as any).name).toEqual("Event Test Project");
    });

    test("grants creator full permissions", async () => {
      const result = await projectService.createProject(
        { name: "Permissions Test Project", actorUserId: ownerUserId },
        { db }
      );

      const permissions = await queries.getProjectUserPermissions(db, {
        project_id: result.projectId,
        user_id: ownerUserId,
      });

      expect(permissions).toContain(ProjectPermission.PROJECT_MANAGE_USERS);
      expect(permissions).toContain(ProjectPermission.PROJECT_READ_USERS);
      expect(permissions).toContain(ProjectPermission.PROJECT_READ_EVENTS);
    });

    test("logs PERMISSION_GRANTED events for initial permissions", async () => {
      const result = await projectService.createProject(
        { name: "Permission Events Project", actorUserId: ownerUserId },
        { db }
      );

      const events = await queries.getEvents(db, { project_id: result.projectId, type: EventType.PROJECT_USER_PERMISSION_GRANTED });

      expect(events.length).toBe(3);
    });

    test("throws AUTHENTICATION_ERROR when actor user does not exist", async () => {
      const nonExistentUserId = "00000000-0000-0000-0000-000000000000" as UUID;
      try {
        await projectService.createProject(
          { name: "Should Fail", actorUserId: nonExistentUserId },
          { db }
        );
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect((error as Error).name).toBe(ErrorCode.AUTHENTICATION_ERROR);
      }
    });
  });

  describe("getProjects", () => {
    let testProjectId: UUID;

    beforeAll(async () => {
      const result = await projectService.createProject(
        { name: "List Test Project", actorUserId: ownerUserId },
        { db }
      );
      testProjectId = result.projectId;
    });

    test("returns projects where user has permissions", async () => {
      const result = await projectService.getProjects({ actorUserId: ownerUserId }, { db });

      expect(result.projects.length).toBeGreaterThan(0);
      expect(result.projects.some((p) => p.id === testProjectId)).toBe(true);
    });

    test("returns empty for user without any project permissions", async () => {
      const result = await projectService.getProjects({ actorUserId: nonMemberUserId }, { db });

      expect(result.projects.length).toBe(0);
    });
  });

  describe("getProject", () => {
    let testProjectId: UUID;

    beforeAll(async () => {
      const result = await projectService.createProject(
        { name: "Get Project Test", actorUserId: ownerUserId },
        { db }
      );
      testProjectId = result.projectId;
    });

    test("returns project for user with access", async () => {
      const result = await projectService.getProject(
        { projectId: testProjectId, actorUserId: ownerUserId },
        { db }
      );

      expect(result.project).toBeDefined();
      expect(result.project.id).toBe(testProjectId);
      expect(result.project.name).toBe("Get Project Test");
      expect(result.project.webhookPathAllowlist).toEqual([]);
    });

    test("throws for user without access", async () => {
      await expect(
        projectService.getProject({ projectId: testProjectId, actorUserId: nonMemberUserId }, { db })
      ).rejects.toThrow(ErrorCode.PROJECT_NOT_FOUND);
    });

    test("throws for non-existent project", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000" as UUID;
      await expect(
        projectService.getProject({ projectId: fakeId, actorUserId: ownerUserId }, { db })
      ).rejects.toThrow();
    });
  });

  describe("setProjectWebhookPathAllowlist", () => {
    let testProjectId: UUID;

    beforeAll(async () => {
      const result = await projectService.createProject(
        { name: "Webhook Allowlist Test", actorUserId: ownerUserId },
        { db }
      );
      testProjectId = result.projectId;
    });

    test("replaces the webhook path allowlist", async () => {
      const result = await projectService.setProjectWebhookPathAllowlist(
        {
          projectId: testProjectId,
          paths: ["/stripe", "/github/hooks"],
          actorUserId: ownerUserId,
        },
        { db }
      );

      expect(result.webhookPathAllowlist).toEqual(["/stripe", "/github/hooks"]);

      const project = await projectService.getProject(
        { projectId: testProjectId, actorUserId: ownerUserId },
        { db }
      );
      expect(project.project.webhookPathAllowlist).toEqual(["/stripe", "/github/hooks"]);
    });

    test("throws PROJECT_NOT_FOUND when actor lacks manage permission", async () => {
      await queries.allowProjectUserPermission(db, {
        project_id: testProjectId,
        user_id: memberUserId,
        permission: ProjectPermission.PROJECT_READ_USERS,
      });

      await expect(
        projectService.setProjectWebhookPathAllowlist(
          {
            projectId: testProjectId,
            paths: ["/stripe"],
            actorUserId: memberUserId,
          },
          { db }
        )
      ).rejects.toThrow(ErrorCode.PROJECT_NOT_FOUND);
    });
  });

  describe("getProjectUsers", () => {
    let testProjectId: UUID;

    beforeAll(async () => {
      const result = await projectService.createProject(
        { name: "Users Test Project", actorUserId: ownerUserId },
        { db }
      );
      testProjectId = result.projectId;
    });

    test("returns users for user with read permission", async () => {
      const result = await projectService.getProjectUsers(
        { projectId: testProjectId, actorUserId: ownerUserId },
        { db }
      );

      expect(result.users.length).toBe(1);
      expect(result.users[0]?.userId).toBe(ownerUserId);
      expect(result.users[0]?.permissions).toContain(ProjectPermission.PROJECT_MANAGE_USERS);
    });

    test("throws PROJECT_NOT_FOUND for user without read permission", async () => {
      await expect(
        projectService.getProjectUsers({ projectId: testProjectId, actorUserId: nonMemberUserId }, { db })
      ).rejects.toThrow(ErrorCode.PROJECT_NOT_FOUND);
    });
  });

  describe("addUserToProject", () => {
    let testProjectId: UUID;

    beforeAll(async () => {
      const result = await projectService.createProject(
        { name: "Add User Service Test", actorUserId: ownerUserId },
        { db }
      );
      testProjectId = result.projectId;
    });

    test("adds user to project by user id", async () => {
      await projectService.addUserToProject(
        {
          projectId: testProjectId,
          userIdToAdd: memberUserId,
          permissions: [ProjectPermission.PROJECT_READ_USERS],
          actorUserId: ownerUserId,
        },
        { db }
      );

      const users = await projectService.getProjectUsers(
        { projectId: testProjectId, actorUserId: ownerUserId },
        { db }
      );
      expect(users.users.some((u) => u.userId === memberUserId)).toBe(true);
    });

    test("throws when user id not found", async () => {
      await expect(
        projectService.addUserToProject(
          {
            projectId: testProjectId,
            userIdToAdd: "00000000-0000-0000-0000-000000000000" as UUID,
            permissions: [ProjectPermission.PROJECT_READ_USERS],
            actorUserId: ownerUserId,
          },
          { db }
        )
      ).rejects.toThrow(ErrorCode.USER_NOT_FOUND);
    });

    test("throws PROJECT_NOT_FOUND when actor lacks manage permission", async () => {
      // Create a user with only read permission
      const readOnlyDisplayName = `readonly-add-${Date.now()}`;
      const readOnlyUserId = (await queries.insertUser(db, {
        display_name: readOnlyDisplayName,
      })) as UUID;

      await queries.allowProjectUserPermission(db, {
        project_id: testProjectId,
        user_id: readOnlyUserId,
        permission: ProjectPermission.PROJECT_READ_USERS,
      });

      await expect(
        projectService.addUserToProject(
          {
            projectId: testProjectId,
            userIdToAdd: memberUserId,
            permissions: [ProjectPermission.PROJECT_READ_USERS],
            actorUserId: readOnlyUserId,
          },
          { db }
        )
      ).rejects.toThrow(ErrorCode.PROJECT_NOT_FOUND);
    });
  });

  describe("updateUserProjectPermissions", () => {
    let testProjectId: UUID;
    let targetUserId: UUID;
    let targetDisplayName: string;

    beforeAll(async () => {
      const result = await projectService.createProject(
        { name: "Update Permissions Test", actorUserId: ownerUserId },
        { db }
      );
      testProjectId = result.projectId;

      targetDisplayName = `target-${Date.now()}`;
      targetUserId = (await queries.insertUser(db, {
        display_name: targetDisplayName,
      })) as UUID;

      // Add target user with read permission
      await projectService.addUserToProject(
        {
          projectId: testProjectId,
          userIdToAdd: targetUserId,
          permissions: [ProjectPermission.PROJECT_READ_USERS],
          actorUserId: ownerUserId,
        },
        { db }
      );
    });

    test("updates user permissions", async () => {
      await projectService.updateUserProjectPermissions(
        {
          projectId: testProjectId,
          userIdToUpdate: targetUserId,
          permissions: [ProjectPermission.PROJECT_MANAGE_USERS, ProjectPermission.PROJECT_READ_USERS, ProjectPermission.PROJECT_READ_EVENTS],
          actorUserId: ownerUserId,
        },
        { db }
      );

      const permissions = await queries.getProjectUserPermissions(db, {
        project_id: testProjectId,
        user_id: targetUserId,
      });
      expect(permissions).toContain(ProjectPermission.PROJECT_MANAGE_USERS);
      expect(permissions).toContain(ProjectPermission.PROJECT_READ_USERS);
    });

    test("throws PROJECT_NOT_FOUND when actor lacks manage permission", async () => {
      // Create a user with only read permission for this test
      const readOnlyDisplayName = `readonly-update-${Date.now()}`;
      const readOnlyUserId = (await queries.insertUser(db, {
        display_name: readOnlyDisplayName,
      })) as UUID;

      await queries.allowProjectUserPermission(db, {
        project_id: testProjectId,
        user_id: readOnlyUserId,
        permission: ProjectPermission.PROJECT_READ_USERS,
      });

      await expect(
        projectService.updateUserProjectPermissions(
          {
            projectId: testProjectId,
            userIdToUpdate: targetUserId,
            permissions: [],
            actorUserId: readOnlyUserId,
          },
          { db }
        )
      ).rejects.toThrow(ErrorCode.PROJECT_NOT_FOUND);
    });
  });

  describe("removeUserFromProject", () => {
    let testProjectId: UUID;
    let userToRemoveId: UUID;
    let userToRemoveDisplayName: string;

    beforeAll(async () => {
      const result = await projectService.createProject(
        { name: "Remove User Service Test", actorUserId: ownerUserId },
        { db }
      );
      testProjectId = result.projectId;

      userToRemoveDisplayName = `removable-${Date.now()}`;
      userToRemoveId = (await queries.insertUser(db, {
        display_name: userToRemoveDisplayName,
      })) as UUID;

      await projectService.addUserToProject(
        {
          projectId: testProjectId,
          userIdToAdd: userToRemoveId,
          permissions: [ProjectPermission.PROJECT_READ_USERS],
          actorUserId: ownerUserId,
        },
        { db }
      );
    });

    test("removes user from project", async () => {
      await projectService.removeUserFromProject(
        {
          projectId: testProjectId,
          userIdToRemove: userToRemoveId,
          actorUserId: ownerUserId,
        },
        { db }
      );

      const users = await projectService.getProjectUsers(
        { projectId: testProjectId, actorUserId: ownerUserId },
        { db }
      );
      expect(users.users.some((u) => u.userId === userToRemoveId)).toBe(false);
    });

    test("throws when user not in project", async () => {
      await expect(
        projectService.removeUserFromProject(
          {
            projectId: testProjectId,
            userIdToRemove: nonMemberUserId,
            actorUserId: ownerUserId,
          },
          { db }
        )
      ).rejects.toThrow(ErrorCode.USER_NOT_FOUND);
    });

    test("throws when trying to remove yourself", async () => {
      await expect(
        projectService.removeUserFromProject(
          {
            projectId: testProjectId,
            userIdToRemove: ownerUserId,
            actorUserId: ownerUserId,
          },
          { db }
        )
      ).rejects.toThrow(ErrorCode.BAD_REQUEST);
    });

    test("throws PROJECT_NOT_FOUND when actor lacks manage permission", async () => {
      // Add a user with only read permission to act as the actor
      const readOnlyDisplayName = `readonly-remove-${Date.now()}`;
      const readOnlyUserId = (await queries.insertUser(db, {
        display_name: readOnlyDisplayName,
      })) as UUID;

      await queries.allowProjectUserPermission(db, {
        project_id: testProjectId,
        user_id: readOnlyUserId,
        permission: ProjectPermission.PROJECT_READ_USERS,
      });

      // Add another user to try to remove
      const targetDisplayName = `target-remove-${Date.now()}`;
      const targetUserId = (await queries.insertUser(db, {
        display_name: targetDisplayName,
      })) as UUID;

      await queries.allowProjectUserPermission(db, {
        project_id: testProjectId,
        user_id: targetUserId,
        permission: ProjectPermission.PROJECT_READ_USERS,
      });

      await expect(
        projectService.removeUserFromProject(
          {
            projectId: testProjectId,
            userIdToRemove: targetUserId,
            actorUserId: readOnlyUserId,
          },
          { db }
        )
      ).rejects.toThrow(ErrorCode.PROJECT_NOT_FOUND);
    });
  });
});
