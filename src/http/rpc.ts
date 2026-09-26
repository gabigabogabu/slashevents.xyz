import { z } from 'zod';

import type { Pg } from '@/db/init';
import * as queries from '@/db/queries';
import type { SQL } from '@/db/types';
import { AppError, ErrorCode } from '@/errors';
import { RpcHandler, defRpc } from '@/lib/rpc/handler';
import type { Log } from '@/log';
import * as services from '@/services';
import { EventType } from '@/services/events/types';

import { isValidWebhookPathPattern } from './webhook-path-allowlist';

import type { UUID } from 'node:crypto';

export type RpcContext = { signal: AbortSignal };

const projectSummarySchema = z.object({
  id: z.uuidv7(),
  name: z.string(),
  createdAt: z.string(),
});

const retentionConfigSchema = z.object({
  durationSeconds: z.number().int().min(1).max(2_147_483_647).nullable(),
  maxEvents: z.number().int().min(1).max(2_147_483_647).nullable(),
});

export const createAppRpcHandler = (di: { db: SQL; pg: Pg; log: Log }) => {
  const deps = { ...di, services, queries };
  const webhookPathSchema = z.array(
    z.string().trim().min(1).max(2048)
      .refine((path) => path.startsWith('/') || path.startsWith('^/'), 'Pattern must match an absolute path')
      .refine(isValidWebhookPathPattern(deps.log), 'Pattern must be a valid regular expression'),
  );
  const projectSchema = projectSummarySchema.extend({
    webhookPathAllowlist: webhookPathSchema,
    retentionConfig: retentionConfigSchema,
  });
  return new RpcHandler({
    createProject: defRpc({
      inputValidation: z.object({ name: z.string().trim().min(1).max(255) }),
      outputValidation: z.object({ projectId: z.uuidv7() }),
      handle: async ({ params }) =>
        deps.services.projects.createProject({
          name: params.name,
        }, {
          db: deps.db,
          queries: deps.queries,
          log: deps.log,
        }),
    }),

    getProjects: defRpc({
      inputValidation: z.object({
        cursor: z.uuidv7().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      outputValidation: z.object({
        projects: z.array(projectSummarySchema),
        nextCursor: z.uuidv7().optional(),
      }),
      handle: async ({ params }) =>
        deps.services.projects.getProjects({
          cursor: params.cursor as UUID | undefined,
          limit: params.limit,
        }, { db: deps.db, queries: deps.queries, log: deps.log }),
    }),

    getProject: defRpc({
      inputValidation: z.object({ projectId: z.uuidv7() }),
      outputValidation: z.object({ project: projectSchema }),
      handle: async ({ params }) =>
        deps.services.projects.getProject({
          projectId: params.projectId as UUID,
        }, { db: deps.db, queries: deps.queries, log: deps.log }),
    }),

    setProjectWebhookPathAllowlist: defRpc({
      description: "Sets the project's webhook ingress allowlist. paths entries are full-match regular expression patterns evaluated against the path after /ingress/{projectId}. Literal paths such as /provider/hooks work; use patterns such as /customers/[^/]+/events for paths with IDs.",
      inputValidation: z.object({
        projectId: z.uuidv7(),
        paths: webhookPathSchema.max(64),
      }),
      outputValidation: z.object({ webhookPathAllowlist: webhookPathSchema }),
      handle: async ({ params }) =>
        deps.services.projects.setProjectWebhookPathAllowlist({
          projectId: params.projectId as UUID,
          paths: params.paths,
        }, { db: deps.db, queries: deps.queries, log: deps.log }),
    }),

    getProjectWebhookPathAllowlist: defRpc({
      description: "Returns the project's webhook ingress allowlist as full-match regular expression path patterns.",
      inputValidation: z.object({ projectId: z.uuidv7() }),
      outputValidation: z.object({ webhookPathAllowlist: webhookPathSchema }),
      handle: async ({ params }) =>
        deps.services.projects.getProjectWebhookPathAllowlist({
          projectId: params.projectId as UUID,
        }, { db: deps.db, queries: deps.queries, log: deps.log }),
    }),

    setProjectRetentionConfig: defRpc({
      inputValidation: z.object({
        projectId: z.uuidv7(),
        retentionConfig: retentionConfigSchema,
      }),
      outputValidation: z.object({
        retentionConfig: retentionConfigSchema,
      }),
      handle: async ({ params }) =>
        deps.services.projects.setProjectRetentionConfig({
          projectId: params.projectId as UUID,
          retentionConfig: params.retentionConfig,
        }, { db: deps.db, queries: deps.queries, log: deps.log }),
    }),

    getProjectRetentionConfig: defRpc({
      inputValidation: z.object({ projectId: z.uuidv7() }),
      outputValidation: z.object({ retentionConfig: retentionConfigSchema }),
      handle: async ({ params }) =>
        deps.services.projects.getProjectRetentionConfig({
          projectId: params.projectId as UUID,
        }, { db: deps.db, queries: deps.queries, log: deps.log }),
    }),

    getEvents: defRpc({
      inputValidation: z.object({
        projectId: z.uuidv7(),
        type: z.enum(EventType).optional(),
        limit: z.number().int().min(1).max(100).default(100),
        cursor: z.string().optional(),
        longPollDurationSeconds: z.number().int().min(0).max(60).default(0),
      }),
      outputValidation: z.object({
        events: z.array(z.object({
          id: z.uuidv7(),
          projectId: z.uuidv7(),
          type: z.enum(EventType),
          data: z.unknown(),
          receivedAt: z.string(),
        })),
        nextCursor: z.string().nullable(),
        hasMore: z.boolean(),
      }),
      handle: async ({ params, context }) => {
        const projectId = params.projectId as UUID;
        if (!await deps.queries.projectExists(deps.db, { project_id: projectId }))
          throw new AppError(ErrorCode.PROJECT_NOT_FOUND, 404);
        return deps.services.events.getEventsLongPoll({
          projectId,
          type: params.type,
          limit: params.limit,
          cursor: params.cursor,
          longPollDurationSeconds: params.longPollDurationSeconds,
        }, {
          db: deps.db,
          pg: deps.pg,
          queries: deps.queries,
          log: deps.log,
          signal: (context as RpcContext).signal,
        });
      },
    }),

    removeEvent: defRpc({
      inputValidation: z.object({
        projectId: z.uuidv7(),
        eventId: z.uuidv7(),
      }),
      outputValidation: z.object({ ok: z.boolean() }),
      handle: async ({ params }) => {
        await deps.services.events.removeEvent({
          projectId: params.projectId as UUID,
          eventId: params.eventId as UUID,
        }, { db: deps.db, queries: deps.queries, log: deps.log });
        return { ok: true };
      },
    }),

  });
};
