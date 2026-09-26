import type * as dbQueries from '@/db/queries';
import type { SQL } from '@/db/types';
import { AppError, ErrorCode } from '@/errors';
import { timestampToIsoString } from '@/lib/timestamps';
import type { Log } from '@/log';
import { EventType } from '@/services/events/types';

import type { UUID } from 'crypto';

const projectListDefaultLimit = 50;
const projectListMaxLimit = 100;

export type ProjectRetentionConfig = {
  durationSeconds: number | null;
  maxEvents: number | null;
};

type ProjectDi = {
  db: SQL;
  queries: typeof dbQueries;
  log: Log;
};

export const createProject = async (
  { name }: { name: string },
  di: ProjectDi,
): Promise<{ projectId: UUID }> => {
  const { db, queries } = di;

  return await db.begin('read write', async (tx) => {
    const projectId = await queries.insertProject(tx, {
      name,
    });

    if (!projectId)
      throw new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 500, 'Failed to create project');

    await queries.insertProjectActivityEvent(tx, {
      project_id: projectId,
      event_type: EventType.PROJECT_CREATED,
      metadata: { name },
    });

    return { projectId };
  });
};

export const getProjects = async (
  { cursor, limit: requestedLimit }: { cursor?: UUID; limit?: number },
  { db, queries }: ProjectDi,
): Promise<{ projects: { id: UUID; name: string; createdAt: string }[]; nextCursor?: UUID }> => {
  const limit = Math.min(Math.max(requestedLimit ?? projectListDefaultLimit, 1), projectListMaxLimit);
  const projects = await queries.getProjects(db, {
    before_id: cursor,
    limit: limit + 1,
  });
  const visibleProjects = projects.slice(0, limit);
  return {
    projects: visibleProjects.map((p) => ({ ...p, createdAt: timestampToIsoString(p.created_at) })),
    nextCursor: projects.length > limit ? visibleProjects[visibleProjects.length - 1]?.id : undefined,
  };
};

export const getProject = async (
  { projectId }: { projectId: UUID },
  { db, queries }: ProjectDi,
): Promise<{ project: { id: UUID; name: string; webhookPathAllowlist: string[]; retentionConfig: ProjectRetentionConfig; createdAt: string } }> => {

  const project = await queries.getProjectById(db, { id: projectId });
  if (!project)
    throw new AppError(ErrorCode.PROJECT_NOT_FOUND, 404);

  return {
    project: {
      id: project.id,
      name: project.name,
      webhookPathAllowlist: project.webhook_path_allowlist,
      retentionConfig: {
        durationSeconds: project.retention_duration_seconds,
        maxEvents: project.retention_max_events,
      },
      createdAt: timestampToIsoString(project.created_at),
    },
  };
};

export const getProjectWebhookPathAllowlist = async (
  { projectId }: { projectId: UUID },
  { db, queries }: ProjectDi,
): Promise<{ webhookPathAllowlist: string[] }> => {

  const webhookPathAllowlist = await queries.getProjectWebhookPathAllowlist(db, { project_id: projectId });
  if (!webhookPathAllowlist)
    throw new AppError(ErrorCode.PROJECT_NOT_FOUND, 404);

  return { webhookPathAllowlist };
};

export const setProjectWebhookPathAllowlist = async (
  { projectId, paths }: { projectId: UUID; paths: string[] },
  { db, queries }: ProjectDi,
): Promise<{ webhookPathAllowlist: string[] }> => {

  const updated = await queries.updateProjectWebhookPathAllowlist(db, {
    project_id: projectId,
    webhook_path_allowlist: paths,
  });
  if (!updated)
    throw new AppError(ErrorCode.PROJECT_NOT_FOUND, 404);

  return { webhookPathAllowlist: paths };
};

export const getProjectRetentionConfig = async (
  { projectId }: { projectId: UUID },
  { db, queries }: ProjectDi,
): Promise<{ retentionConfig: ProjectRetentionConfig }> => {

  const project = await queries.getProjectById(db, { id: projectId });
  if (!project)
    throw new AppError(ErrorCode.PROJECT_NOT_FOUND, 404);

  return {
    retentionConfig: {
      durationSeconds: project.retention_duration_seconds,
      maxEvents: project.retention_max_events,
    },
  };
};

export const setProjectRetentionConfig = async (
  {
    projectId,
    retentionConfig,
  }: { projectId: UUID; retentionConfig: ProjectRetentionConfig },
  { db, queries }: ProjectDi,
): Promise<{ retentionConfig: ProjectRetentionConfig }> => {

  const updated = await queries.updateProjectRetentionConfig(db, {
    project_id: projectId,
    retention_duration_seconds: retentionConfig.durationSeconds,
    retention_max_events: retentionConfig.maxEvents,
  });
  if (!updated)
    throw new AppError(ErrorCode.PROJECT_NOT_FOUND, 404);

  return { retentionConfig };
};
