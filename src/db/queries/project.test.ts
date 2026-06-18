import { afterAll, beforeAll, describe, test } from "bun:test";

import { expect } from "@/test-expect";
import type { SQL } from "@/db/types";
import type { UUID } from "crypto";
import {
  insertProject,
  getProjectById,
  getProjectsByUserId,
  allowProjectUserPermission,
  revokeProjectUserPermission,
  deleteAllProjectUserPermissions,
  getProjectUserPermissions,
  checkUserHasProjectPermission,
  checkUserHasAnyProjectPermission,
  getProjectUsers,
} from "./project";
import { ProjectPermission } from "@/lib/project-permissions";
import { insertUser } from "./user";
import { getTestDb, resetTestDb } from "../test-setup";

describe("project queries", () => {
  let db: SQL;
  let testUserId: UUID;
  let testUser2Id: UUID;
  let testProjectId: UUID;

  beforeAll(async () => {
    db = getTestDb();
    await resetTestDb(db);

    // Create test users
    testUserId = (await insertUser(db, {
      display_name: `test-project-${Date.now()}@example.com`,
    })) as UUID;

    testUser2Id = (await insertUser(db, {
      display_name: `test-project2-${Date.now()}@example.com`,
    })) as UUID;
  });

  afterAll(async () => {
    await db.end();
  });

  test("insertProject creates a project and returns the id", async () => {
    const projectId = await insertProject(db, {
      name: "Test Project",
      created_by_user_id: testUserId,
    });

    expect(projectId).toBeDefined();
    if (!projectId) throw new Error("Expected insertProject to return a project id");
    expect(typeof projectId).toBe("string");
    expect(projectId.length).toBeGreaterThan(0);

    testProjectId = projectId;
  });

  test("getProjectById returns the project", async () => {
    const project = await getProjectById(db, { id: testProjectId });

    expect(project).toBeDefined();
    expect(project?.id).toBe(testProjectId);
    expect(project?.name).toBe("Test Project");
    expect(project?.created_by_user_id).toBe(testUserId);
  });

  test("getProjectById returns undefined for non-existent project", async () => {
    const project = await getProjectById(db, { id: "00000000-0000-0000-0000-000000000000" as UUID });

    expect(project).toBeUndefined();
  });

  test("insertProjectUserPermission adds a permission", async () => {
    const permId = await allowProjectUserPermission(db, {
      project_id: testProjectId,
      user_id: testUserId,
      permission: ProjectPermission.PROJECT_MANAGE_USERS,
    });

    expect(permId).toBeDefined();
    expect(typeof permId).toBe("string");
  });

  test("insertProjectUserPermission adds another permission for same user", async () => {
    const permId = await allowProjectUserPermission(db, {
      project_id: testProjectId,
      user_id: testUserId,
      permission: ProjectPermission.PROJECT_READ_USERS,
    });

    expect(permId).toBeDefined();
  });

  test("getProjectUserPermissions returns user permissions", async () => {
    const permissions = await getProjectUserPermissions(db, {
      project_id: testProjectId,
      user_id: testUserId,
    });

    expect(permissions).toContain(ProjectPermission.PROJECT_MANAGE_USERS);
    expect(permissions).toContain(ProjectPermission.PROJECT_READ_USERS);
    expect(permissions.length).toBe(2);
  });

  test("checkUserHasProjectPermission returns true for existing permission", async () => {
    const hasPermission = await checkUserHasProjectPermission(db, {
      project_id: testProjectId,
      user_id: testUserId,
      permission: ProjectPermission.PROJECT_MANAGE_USERS,
    });

    expect(hasPermission).toBe(true);
  });

  test("checkUserHasProjectPermission returns false for non-existing permission", async () => {
    const hasPermission = await checkUserHasProjectPermission(db, {
      project_id: testProjectId,
      user_id: testUser2Id,
      permission: ProjectPermission.PROJECT_MANAGE_USERS,
    });

    expect(hasPermission).toBe(false);
  });

  test("checkUserHasAnyProjectPermission returns true for user with permissions", async () => {
    const hasAny = await checkUserHasAnyProjectPermission(db, {
      project_id: testProjectId,
      user_id: testUserId,
    });

    expect(hasAny).toBe(true);
  });

  test("checkUserHasAnyProjectPermission returns false for user without permissions", async () => {
    const hasAny = await checkUserHasAnyProjectPermission(db, {
      project_id: testProjectId,
      user_id: testUser2Id,
    });

    expect(hasAny).toBe(false);
  });

  test("getProjectsByUserId returns projects for user", async () => {
    const projects = await getProjectsByUserId(db, { user_id: testUserId });

    expect(projects.length).toBeGreaterThan(0);
    expect(projects.some((p) => p.id === testProjectId)).toBe(true);
  });

  test("getProjectsByUserId returns empty for user without projects", async () => {
    const projects = await getProjectsByUserId(db, { user_id: testUser2Id });

    expect(projects.length).toBe(0);
  });

  test("getProjectUsers returns users with their permissions", async () => {
    const users = await getProjectUsers(db, { project_id: testProjectId });

    expect(users.length).toBe(1);
    expect(users[0]?.user_id).toBe(testUserId);
    expect(users[0]?.permissions).toContain(ProjectPermission.PROJECT_MANAGE_USERS);
    expect(users[0]?.permissions).toContain(ProjectPermission.PROJECT_READ_USERS);
  });

  test("deleteProjectUserPermission removes a specific permission", async () => {
    const deleted = await revokeProjectUserPermission(db, {
      project_id: testProjectId,
      user_id: testUserId,
      permission: ProjectPermission.PROJECT_READ_USERS,
    });

    expect(deleted).toBe(true);

    const permissions = await getProjectUserPermissions(db, {
      project_id: testProjectId,
      user_id: testUserId,
    });

    expect(permissions).not.toContain(ProjectPermission.PROJECT_READ_USERS);
    expect(permissions).toContain(ProjectPermission.PROJECT_MANAGE_USERS);
  });

  test("deleteAllProjectUserPermissions removes all permissions for a user", async () => {
    // First add a permission for user2
    await allowProjectUserPermission(db, {
      project_id: testProjectId,
      user_id: testUser2Id,
      permission: ProjectPermission.PROJECT_READ_USERS,
    });

    const count = await deleteAllProjectUserPermissions(db, {
      project_id: testProjectId,
      user_id: testUser2Id,
    });

    expect(count).toBe(1);

    const hasAny = await checkUserHasAnyProjectPermission(db, {
      project_id: testProjectId,
      user_id: testUser2Id,
    });

    expect(hasAny).toBe(false);
  });
});
