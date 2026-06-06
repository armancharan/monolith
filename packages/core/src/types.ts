/**
 * Placeholder resource node — C3/C4 will specialize Worker and bindings.
 */
export interface Resource {
  readonly id: string
  readonly kind: string
}

/**
 * Desired infrastructure graph for one stage — filled by import + monolith.run.ts.
 */
export interface Stack {
  readonly name: string
  readonly resources: readonly Resource[]
}
