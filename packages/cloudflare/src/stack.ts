import { Effect } from "effect"
import type { StackConfigure, StackContext, StackModule } from "@monolith/core"

/** Placeholder Worker resource — reconcile in C3. */
export interface WorkerResource {
  type: "worker"
  name: string
}

/** Placeholder D1 binding — reconcile in C4. */
export interface D1Database {
  type: "d1"
  name: string
  databaseId?: string
}

/** Placeholder R2 binding — reconcile in C4. */
export interface R2Bucket {
  type: "r2"
  name: string
  bucketName?: string
}

/** Placeholder KV binding — reconcile in C4. */
export interface KvNamespace {
  type: "kv"
  name: string
  namespaceId?: string
}

/** Placeholder Queue producer binding — reconcile in C4. */
export interface QueueBinding {
  type: "queue"
  name: string
  queueName?: string
  id?: string
}

/** Placeholder Durable Object binding — reconcile in C4. */
export interface DurableObjectBinding {
  type: "durable_object"
  name: string
  className?: string
  scriptName?: string
}

export type CloudflareBinding =
  | D1Database
  | R2Bucket
  | KvNamespace
  | QueueBinding
  | DurableObjectBinding

export interface CloudflareStackContext extends StackContext {
  worker: (name: string) => Effect.Effect<WorkerResource, never>
  d1: (name: string, opts?: { databaseId?: string }) => Effect.Effect<D1Database, never>
  r2: (name: string, opts?: { bucketName?: string }) => Effect.Effect<R2Bucket, never>
  kv: (name: string, opts?: { namespaceId?: string }) => Effect.Effect<KvNamespace, never>
  queue: (
    name: string,
    opts?: { queueName?: string; id?: string }
  ) => Effect.Effect<QueueBinding, never>
  durableObject: (
    name: string,
    opts?: { className?: string; scriptName?: string }
  ) => Effect.Effect<DurableObjectBinding, never>
}

function createCloudflareHelpers(): Omit<CloudflareStackContext, keyof StackContext> {
  return {
    worker: (name) => Effect.succeed({ type: "worker", name }),
    d1: (name, opts) =>
      Effect.succeed({ type: "d1", name, databaseId: opts?.databaseId }),
    r2: (name, opts) =>
      Effect.succeed({ type: "r2", name, bucketName: opts?.bucketName }),
    kv: (name, opts) =>
      Effect.succeed({ type: "kv", name, namespaceId: opts?.namespaceId }),
    queue: (name, opts) =>
      Effect.succeed({
        type: "queue",
        name,
        queueName: opts?.queueName,
        id: opts?.id
      }),
    durableObject: (name, opts) =>
      Effect.succeed({
        type: "durable_object",
        name,
        className: opts?.className,
        scriptName: opts?.scriptName
      })
  }
}

export type CloudflareStackConfigure = (
  ctx: CloudflareStackContext
) => Effect.Effect<void, never>

export function stack(
  name: string,
  configure: CloudflareStackConfigure
): StackModule {
  const helpers = createCloudflareHelpers()
  const wrapped: StackConfigure = (ctx) => configure({ ...ctx, ...helpers })

  return { name, configure: wrapped }
}
