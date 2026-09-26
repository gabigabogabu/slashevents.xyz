import type { SQL } from '@/db/types';

import type { UUID } from 'crypto';

type ProjectDbRow = {
  id: UUID;
  name: string;
  webhook_path_allowlist: string[];
  retention_duration_seconds: number | null;
  retention_max_events: number | null;
  created_at: string;
  updated_at: string;
};

const parseWebhookPathAllowlist = (value: string[] | string): string[] =>
  Array.isArray(value) ? value : JSON.parse(value) as string[];

export const insertProject = async (
  db: SQL,
  params: { name: string },
): Promise<UUID | undefined> => {
  const res = (await db`INSERT INTO projects ${db(params, 'name')} RETURNING id;`) as Pick<
    ProjectDbRow,
    'id'
  >[];
  return res[0]?.id;
};

export const getProjectById = async (
  db: SQL,
  params: { id: UUID },
): Promise<ProjectDbRow | undefined> => {
  const res =
    await db`SELECT id, name, webhook_path_allowlist, retention_duration_seconds, retention_max_events, created_at, updated_at FROM projects WHERE id = ${params.id};` as (ProjectDbRow & { webhook_path_allowlist: string[] | string })[];
  const project = res[0];
  return project ? { ...project, webhook_path_allowlist: parseWebhookPathAllowlist(project.webhook_path_allowlist) } : undefined;
};

export const getProjectWebhookPathAllowlist = async (
  db: SQL,
  params: { project_id: UUID },
): Promise<string[] | undefined> => {
  const res =
    await db`SELECT webhook_path_allowlist FROM projects WHERE id = ${params.project_id};` as Pick<
      ProjectDbRow & { webhook_path_allowlist: string[] | string },
      'webhook_path_allowlist'
    >[];
  const webhookPathAllowlist = res[0]?.webhook_path_allowlist;
  return webhookPathAllowlist ? parseWebhookPathAllowlist(webhookPathAllowlist) : undefined;
};

export const updateProjectWebhookPathAllowlist = async (
  db: SQL,
  params: { project_id: UUID; webhook_path_allowlist: string[] },
): Promise<boolean> => {
  const res = await db`
    UPDATE projects
    SET webhook_path_allowlist = ${JSON.stringify(params.webhook_path_allowlist)}::jsonb
    WHERE id = ${params.project_id}
    RETURNING id;
  ` as Pick<ProjectDbRow, 'id'>[];
  return res.length > 0;
};

export const updateProjectRetentionConfig = async (
  db: SQL,
  params: { project_id: UUID; retention_duration_seconds: number | null; retention_max_events: number | null },
): Promise<boolean> => {
  const res = await db`
    UPDATE projects
    SET retention_duration_seconds = ${params.retention_duration_seconds},
      retention_max_events = ${params.retention_max_events}
    WHERE id = ${params.project_id}
    RETURNING id;
  ` as Pick<ProjectDbRow, 'id'>[];
  return res.length > 0;
};

export const getProjects = async (
  db: SQL,
  params: { before_id?: UUID; limit: number },
): Promise<Pick<ProjectDbRow, 'id' | 'name' | 'created_at'>[]> => {
  const cursorFilter = params.before_id ? db`WHERE id < ${params.before_id}` : db``;
  return await db`SELECT id, name, created_at FROM projects
    ${cursorFilter} ORDER BY id DESC LIMIT ${params.limit}`;
};
