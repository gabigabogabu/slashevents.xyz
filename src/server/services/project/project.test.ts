import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { SQL } from "bun";
import type { UUID } from "crypto";
import { getTestDb, resetTestDb } from "@/server/db/test-setup";
import { ErrorCode } from "@/lib/errors";
import * as queries from "@/server/db/queries";
import { ProjectPermission } from "@/server/db/queries/project";
import { EventType } from "@/server/db/queries/event";
import * as projectService from "./project";
import * as eventsService from "../events/events";

describe("project service", () => {
  let db: SQL;
  let ownerUserId: UUID;
  let ownerEmail: string;
  let memberUserId: UUID;
  let memberEmail: string;
  let nonMemberUserId: UUID;

  beforeAll(async () => {
    db = getTestDb();
    await resetTestDb(db);

    // Create test users
    ownerEmail = `owner-${Date.now()}@example.com`;
    ownerUserId = (await queries.insertUser(db, {
      email: ownerEmail,
      password_hash: "testhash123",
      password_salt: "testsalt123",
    })) as UUID;

    memberEmail = `member-${Date.now()}@example.com`;
    memberUserId = (await queries.insertUser(db, {
      email: memberEmail,
      password_hash: "testhash123",
      password_salt: "testsalt123",
    })) as UUID;

    nonMemberUserId = (await queries.insertUser(db, {
      email: `nonmember-${Date.now()}@example.com`,
      password_hash: "testhash123",
      password_salt: "testsalt123",
    })) as UUID;
  });

  afterAll(async () => {
    await db.close();
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
    });

    test("throws for user without access", async () => {
      expect(
        projectService.getProject({ projectId: testProjectId, actorUserId: nonMemberUserId }, { db })
      ).rejects.toThrow(ErrorCode.PROJECT_NOT_FOUND);
    });

    test("throws for non-existent project", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000" as UUID;
      expect(
        projectService.getProject({ projectId: fakeId, actorUserId: ownerUserId }, { db })
      ).rejects.toThrow();
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
      expect(
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

    test("adds user to project by email", async () => {
      await projectService.addUserToProject(
        {
          projectId: testProjectId,
          userEmail: memberEmail,
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

    test("throws when user email not found", async () => {
      expect(
        projectService.addUserToProject(
          {
            projectId: testProjectId,
            userEmail: "nonexistent@example.com",
            permissions: [ProjectPermission.PROJECT_READ_USERS],
            actorUserId: ownerUserId,
          },
          { db }
        )
      ).rejects.toThrow(ErrorCode.USER_NOT_FOUND);
    });

    test("throws PROJECT_NOT_FOUND when actor lacks manage permission", async () => {
      // Create a user with only read permission
      const readOnlyEmail = `readonly-add-${Date.now()}@example.com`;
      const readOnlyUserId = (await queries.insertUser(db, {
        email: readOnlyEmail,
        password_hash: "testhash123",
        password_salt: "testsalt123",
      })) as UUID;

      await queries.allowProjectUserPermission(db, {
        project_id: testProjectId,
        user_id: readOnlyUserId,
        permission: ProjectPermission.PROJECT_READ_USERS,
      });

      expect(
        projectService.addUserToProject(
          {
            projectId: testProjectId,
            userEmail: memberEmail,
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
    let targetEmail: string;

    beforeAll(async () => {
      const result = await projectService.createProject(
        { name: "Update Permissions Test", actorUserId: ownerUserId },
        { db }
      );
      testProjectId = result.projectId;

      targetEmail = `target-${Date.now()}@example.com`;
      targetUserId = (await queries.insertUser(db, {
        email: targetEmail,
        password_hash: "testhash123",
        password_salt: "testsalt123",
      })) as UUID;

      // Add target user with read permission
      await projectService.addUserToProject(
        {
          projectId: testProjectId,
          userEmail: targetEmail,
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
      const readOnlyEmail = `readonly-update-${Date.now()}@example.com`;
      const readOnlyUserId = (await queries.insertUser(db, {
        email: readOnlyEmail,
        password_hash: "testhash123",
        password_salt: "testsalt123",
      })) as UUID;

      await queries.allowProjectUserPermission(db, {
        project_id: testProjectId,
        user_id: readOnlyUserId,
        permission: ProjectPermission.PROJECT_READ_USERS,
      });

      expect(
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
    let userToRemoveEmail: string;

    beforeAll(async () => {
      const result = await projectService.createProject(
        { name: "Remove User Service Test", actorUserId: ownerUserId },
        { db }
      );
      testProjectId = result.projectId;

      userToRemoveEmail = `removable-${Date.now()}@example.com`;
      userToRemoveId = (await queries.insertUser(db, {
        email: userToRemoveEmail,
        password_hash: "testhash123",
        password_salt: "testsalt123",
      })) as UUID;

      await projectService.addUserToProject(
        {
          projectId: testProjectId,
          userEmail: userToRemoveEmail,
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
      expect(
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
      expect(
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
      const readOnlyEmail = `readonly-remove-${Date.now()}@example.com`;
      const readOnlyUserId = (await queries.insertUser(db, {
        email: readOnlyEmail,
        password_hash: "testhash123",
        password_salt: "testsalt123",
      })) as UUID;

      await queries.allowProjectUserPermission(db, {
        project_id: testProjectId,
        user_id: readOnlyUserId,
        permission: ProjectPermission.PROJECT_READ_USERS,
      });

      // Add another user to try to remove
      const targetEmail = `target-remove-${Date.now()}@example.com`;
      const targetUserId = (await queries.insertUser(db, {
        email: targetEmail,
        password_hash: "testhash123",
        password_salt: "testsalt123",
      })) as UUID;

      await queries.allowProjectUserPermission(db, {
        project_id: testProjectId,
        user_id: targetUserId,
        permission: ProjectPermission.PROJECT_READ_USERS,
      });

      expect(
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

  describe("getEvents (via eventsService)", () => {
    let testProjectId: UUID;

    beforeAll(async () => {
      const result = await projectService.createProject(
        { name: "Events Test Project", actorUserId: ownerUserId },
        { db }
      );
      testProjectId = result.projectId;
    });

    test("returns project activity events", async () => {
      const result = await eventsService.getEvents(
        { projectId: testProjectId, type: EventType.PROJECT_ACTIVITY },
        { db }
      );

      expect(result.events.length).toBeGreaterThan(0);
      expect(result.total).toBeGreaterThan(0);
      const projectCreatedEvent = result.events.find(
        (e) => e.type === EventType.PROJECT_CREATED
      );
      expect(projectCreatedEvent).toBeDefined();
    });

    test("supports cursor pagination", async () => {
      const resultPage1 = await eventsService.getEvents(
        { projectId: testProjectId, type: EventType.PROJECT_ACTIVITY, limit: 1 },
        { db }
      );

      expect(resultPage1.events.length).toBe(1);
      expect(resultPage1.total).toBeGreaterThan(1);

      // Use the first event's id as cursor to get the next page
      const cursor = resultPage1.events[0]?.id;
      const resultPage2 = await eventsService.getEvents(
        { projectId: testProjectId, type: EventType.PROJECT_ACTIVITY, limit: 1, cursor },
        { db }
      );

      expect(resultPage2.events.length).toBe(1);
      expect(resultPage2.events[0]?.id).not.toBe(resultPage1.events[0]?.id);
    });
  });
});
