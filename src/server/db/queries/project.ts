import type { SQL } from "bun";
import type { UUID } from "crypto";

export enum ProjectPermission {
  PROJECT_MANAGE_USERS = "project_manage_users",
  PROJECT_READ_USERS = "project_read_users",
  PROJECT_READ_EVENTS = "project_read_events",
}

type ProjectDbRow = {
  id: UUID;
  name: string;
  created_by_user_id: UUID;
  created_at: string;
  updated_at: string;
};

type ProjectUserPermissionDbRow = {
  id: UUID;
  project_id: UUID;
  user_id: UUID;
  permission: ProjectPermission;
  created_at: string;
  updated_at: string;
};

export const insertProject = async (
  db: SQL,
  params: { name: string; created_by_user_id: UUID }
): Promise<UUID | undefined> => {
  const res = (await db`INSERT INTO projects ${db(params)} RETURNING id;`) as Pick<
    ProjectDbRow,
    "id"
  >[];
  return res[0]?.id;
};

export const getProjectById = async (
  db: SQL,
  params: { id: UUID }
): Promise<ProjectDbRow | undefined> => {
  const res =
    await db`SELECT id, name, created_by_user_id, created_at, updated_at FROM projects WHERE id = ${params.id};` as ProjectDbRow[];
  return res[0];
};

export const getProjectsByUserId = async (
  db: SQL,
  params: { user_id: UUID }
): Promise<Pick<ProjectDbRow, "id" | "name" | "created_at">[]> => {
  // Get projects where user has any permission
  const res =
    await db`SELECT DISTINCT p.id, p.name, p.created_at 
      FROM projects p
      INNER JOIN project_user_permissions pup ON p.id = pup.project_id
      WHERE pup.user_id = ${params.user_id}
      ORDER BY p.created_at DESC;` as Pick<ProjectDbRow, "id" | "name" | "created_at">[];
  return res;
};

export const allowProjectUserPermission = async (
  db: SQL,
  params: { project_id: UUID; user_id: UUID; permission: ProjectPermission }
): Promise<UUID | undefined> => {
  const res =
    await db`INSERT INTO project_user_permissions ${db(params)} RETURNING id;` as Pick<
      ProjectUserPermissionDbRow,
      "id"
    >[];
  return res[0]?.id;
};

export const revokeProjectUserPermission = async (
  db: SQL,
  params: { project_id: UUID; user_id: UUID; permission: ProjectPermission }
): Promise<boolean> => {
  const res =
    await db`DELETE FROM project_user_permissions 
      WHERE project_id = ${params.project_id} 
      AND user_id = ${params.user_id} 
      AND permission = ${params.permission}
      RETURNING id;` as Pick<ProjectUserPermissionDbRow, "id">[];
  return res.length > 0;
};

export const deleteAllProjectUserPermissions = async (
  db: SQL,
  params: { project_id: UUID; user_id: UUID }
): Promise<number> => {
  const res =
    await db`DELETE FROM project_user_permissions 
      WHERE project_id = ${params.project_id} 
      AND user_id = ${params.user_id}
      RETURNING id;` as Pick<ProjectUserPermissionDbRow, "id">[];
  return res.length;
};

export const getProjectUserPermissions = async (
  db: SQL,
  params: { project_id: UUID; user_id: UUID }
): Promise<ProjectPermission[]> => {
  const res =
    await db`SELECT permission FROM project_user_permissions 
      WHERE project_id = ${params.project_id} 
      AND user_id = ${params.user_id};` as Pick<ProjectUserPermissionDbRow, "permission">[];
  return res.map((r) => r.permission);
};

export const checkUserHasProjectPermission = async (
  db: SQL,
  params: { project_id: UUID; user_id: UUID; permission: ProjectPermission }
): Promise<boolean> => {
  const res =
    await db`SELECT 1 FROM project_user_permissions 
      WHERE project_id = ${params.project_id} 
      AND user_id = ${params.user_id} 
      AND permission = ${params.permission}
      LIMIT 1;` as { "?column?": number }[];
  return res.length > 0;
};

export const checkUserHasAnyProjectPermission = async (
  db: SQL,
  params: { project_id: UUID; user_id: UUID }
): Promise<boolean> => {
  const res =
    await db`SELECT 1 FROM project_user_permissions 
      WHERE project_id = ${params.project_id} 
      AND user_id = ${params.user_id}
      LIMIT 1;` as { "?column?": number }[];
  return res.length > 0;
};

type ProjectUserWithPermissions = {
  user_id: UUID;
  email: string;
  permissions: ProjectPermission[];
};

export const getProjectUsers = async (
  db: SQL,
  params: { project_id: UUID }
): Promise<ProjectUserWithPermissions[]> => {
  const res = await db`
    SELECT 
      u.id as user_id, 
      u.email,
      array_agg(pup.permission) as permissions
    FROM project_user_permissions pup
    INNER JOIN users u ON pup.user_id = u.id
    WHERE pup.project_id = ${params.project_id}
    GROUP BY u.id, u.email
    ORDER BY u.email;
  ` as { user_id: UUID; email: string; permissions: ProjectPermission[] }[];
  return res;
};

