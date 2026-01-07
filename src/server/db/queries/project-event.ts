import type { SQL } from "bun";
import type { UUID } from "crypto";

export enum ProjectEventType {
  PROJECT_CREATED = "project_created",
  USER_ADDED = "user_added",
  USER_REMOVED = "user_removed",
  PERMISSION_GRANTED = "permission_granted",
  PERMISSION_REVOKED = "permission_revoked",
}

type ProjectEventDbRow = {
  id: UUID;
  project_id: UUID;
  actor_user_id: UUID;
  event_type: ProjectEventType;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type ProjectEventWithActorEmail = ProjectEventDbRow & {
  actor_email: string;
};

export const insertProjectEvent = async (
  db: SQL,
  params: {
    project_id: UUID;
    actor_user_id: UUID;
    event_type: ProjectEventType;
    metadata: Record<string, unknown> | null;
  }
): Promise<UUID | undefined> => {
  const res = await db`INSERT INTO project_events ${db(params)} RETURNING id;` as Pick<ProjectEventDbRow, "id">[];
  return res[0]?.id;
};

export const getProjectEvents = async (
  db: SQL,
  params: { project_id: UUID; limit?: number; cursor?: UUID }
): Promise<ProjectEventWithActorEmail[]> => {
  const limit = params.limit ?? 50;

  if (params.cursor) {
    const res = await db`
      SELECT 
        pe.id,
        pe.project_id,
        pe.actor_user_id,
        pe.event_type,
        pe.metadata,
        pe.created_at,
        actor.email as actor_email
      FROM project_events pe
      INNER JOIN users actor ON pe.actor_user_id = actor.id
      WHERE pe.project_id = ${params.project_id}
        AND pe.created_at < (SELECT created_at FROM project_events WHERE id = ${params.cursor})
      ORDER BY pe.created_at DESC
      LIMIT ${limit};
    ` as ProjectEventWithActorEmail[];
    return res;
  }

  const res = await db`
    SELECT 
      pe.id,
      pe.project_id,
      pe.actor_user_id,
      pe.event_type,
      pe.metadata,
      pe.created_at,
      actor.email as actor_email
    FROM project_events pe
    INNER JOIN users actor ON pe.actor_user_id = actor.id
    WHERE pe.project_id = ${params.project_id}
    ORDER BY pe.created_at DESC
    LIMIT ${limit};
  ` as ProjectEventWithActorEmail[];
  return res;
};

export const getProjectEventCount = async (
  db: SQL,
  params: { project_id: UUID }
): Promise<number> => {
  const res = await db`
    SELECT COUNT(*) as count FROM project_events WHERE project_id = ${params.project_id};
  ` as { count: string }[];
  return parseInt(res[0]?.count ?? "0", 10);
};

