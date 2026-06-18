import { ProjectPermission } from "@/lib/project-permissions";
import type { SQL } from "@/db/types";
import type { UUID } from "crypto";

type ProjectDbRow = {
  id: UUID;
  name: string;
  created_by_user_id: UUID;
  webhook_path_allowlist: string[];
  retention_duration_seconds: number | null;
  retention_max_events: number | null;
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

const parseWebhookPathAllowlist = (value: string[] | string): string[] =>
  Array.isArray(value) ? value : JSON.parse(value) as string[];

export const insertProject = async (
  db: SQL,
  params: { name: string; created_by_user_id: UUID }
): Promise<UUID | undefined> => {
  const res = (await db`INSERT INTO projects ${db(params, "name", "created_by_user_id")} RETURNING id;`) as Pick<
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
    await db`SELECT id, name, created_by_user_id, webhook_path_allowlist, retention_duration_seconds, retention_max_events, created_at, updated_at FROM projects WHERE id = ${params.id};` as (ProjectDbRow & { webhook_path_allowlist: string[] | string })[];
  const project = res[0];
  return project ? { ...project, webhook_path_allowlist: parseWebhookPathAllowlist(project.webhook_path_allowlist) } : undefined;
};

export const getProjectWebhookPathAllowlist = async (
  db: SQL,
  params: { project_id: UUID }
): Promise<string[] | undefined> => {
  const res =
    await db`SELECT webhook_path_allowlist FROM projects WHERE id = ${params.project_id};` as Pick<
      ProjectDbRow & { webhook_path_allowlist: string[] | string },
      "webhook_path_allowlist"
    >[];
  const webhookPathAllowlist = res[0]?.webhook_path_allowlist;
  return webhookPathAllowlist ? parseWebhookPathAllowlist(webhookPathAllowlist) : undefined;
};

export const updateProjectWebhookPathAllowlist = async (
  db: SQL,
  params: { project_id: UUID; webhook_path_allowlist: string[] }
): Promise<boolean> => {
  const res = await db`
    UPDATE projects
    SET webhook_path_allowlist = ${JSON.stringify(params.webhook_path_allowlist)}::jsonb
    WHERE id = ${params.project_id}
    RETURNING id;
  ` as Pick<ProjectDbRow, "id">[];
  return res.length > 0;
};

export const updateProjectRetentionConfig = async (
  db: SQL,
  params: { project_id: UUID; retention_duration_seconds: number | null; retention_max_events: number | null }
): Promise<boolean> => {
  const res = await db`
    UPDATE projects
    SET retention_duration_seconds = ${params.retention_duration_seconds},
      retention_max_events = ${params.retention_max_events}
    WHERE id = ${params.project_id}
    RETURNING id;
  ` as Pick<ProjectDbRow, "id">[];
  return res.length > 0;
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
    await db`INSERT INTO project_user_permissions ${db(params, "project_id", "user_id", "permission")} RETURNING id;` as Pick<
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

export const getProjectIdsByUserPermission = async (
  db: SQL,
  params: { user_id: UUID; permission: ProjectPermission },
): Promise<UUID[]> => {
  const res = await db`
    SELECT project_id
    FROM project_user_permissions
    WHERE user_id = ${params.user_id}
      AND permission = ${params.permission}
    ORDER BY created_at ASC;
  ` as { project_id: UUID }[];
  return res.map((r) => r.project_id);
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
  display_name: string;
  permissions: ProjectPermission[];
};

export const getProjectUsers = async (
  db: SQL,
  params: { project_id: UUID }
): Promise<ProjectUserWithPermissions[]> => {
  const res = await db`
    SELECT 
      u.id as user_id, 
      u.display_name,
      array_agg(pup.permission) as permissions
    FROM project_user_permissions pup
    INNER JOIN users u ON pup.user_id = u.id
    WHERE pup.project_id = ${params.project_id}
    GROUP BY u.id, u.display_name
    ORDER BY u.display_name;
  ` as { user_id: UUID; display_name: string; permissions: ProjectPermission[] }[];
  return res;
};
