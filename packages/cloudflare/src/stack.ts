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
  worker: (name: string) => WorkerResource
  d1: (name: string, opts?: { databaseId?: string }) => D1Database
  r2: (name: string, opts?: { bucketName?: string }) => R2Bucket
  kv: (name: string, opts?: { namespaceId?: string }) => KvNamespace
  queue: (name: string, opts?: { queueName?: string; id?: string }) => QueueBinding
  durableObject: (
    name: string,
    opts?: { className?: string; scriptName?: string }
  ) => DurableObjectBinding
}

function createCloudflareHelpers(): Omit<
  CloudflareStackContext,
  keyof StackContext
> {
  return {
    worker: (name) => ({ type: "worker", name }),
    d1: (name, opts) => ({ type: "d1", name, databaseId: opts?.databaseId }),
    r2: (name, opts) => ({ type: "r2", name, bucketName: opts?.bucketName }),
    kv: (name, opts) => ({ type: "kv", name, namespaceId: opts?.namespaceId }),
    queue: (name, opts) => ({
      type: "queue",
      name,
      queueName: opts?.queueName,
      id: opts?.id
    }),
    durableObject: (name, opts) => ({
      type: "durable_object",
      name,
      className: opts?.className,
      scriptName: opts?.scriptName
    })
  }
}

export type CloudflareStackConfigure = (
  ctx: CloudflareStackContext
) => Promise<void>

export function stack(
  name: string,
  configure: CloudflareStackConfigure
): StackModule {
  const wrapped: StackConfigure = async (ctx) => {
    const helpers = createCloudflareHelpers()
    await configure({ ...ctx, ...helpers })
  }

  return { name, configure: wrapped }
}
