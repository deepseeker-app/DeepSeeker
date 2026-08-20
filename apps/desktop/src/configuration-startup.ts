/** One-attempt startup with a last-known-good configuration fallback. */

import type { ConfigurationScheme } from './configuration-schemes.ts'

/** A failed generation whose resources did not reach quiescence, so another Host cannot start safely. */
export class ConfigurationStartupCleanupError extends AggregateError {
  /**
   * @param startupCause - Failure that rejected the Host or renderer startup.
   * @param cleanupCause - Failure while stopping that generation.
   */
  constructor(startupCause: unknown, cleanupCause: unknown) {
    super([startupCause, cleanupCause], 'failed configuration generation could not be stopped')
    this.name = 'ConfigurationStartupCleanupError'
  }
}

/** Operations supplied by the Electron application startup. */
export interface ConfigurationStartupOptions {
  /** Scheme selected for this process generation. */
  readonly initial: ConfigurationScheme
  /** Scheme that may be used as the fallback. */
  readonly lastKnownGoodId: string
  /** Start the Host and wait for its renderer to commit. Failed attempts clean up their resources. */
  readonly start: (scheme: ConfigurationScheme) => Promise<void>
  /** Whether application shutdown forbids a fallback Host generation. */
  readonly cancelled?: () => boolean
  /** Persist the failed selection and resolve the fallback scheme. */
  readonly rollback: (failed: ConfigurationScheme) => ConfigurationScheme
}

/** Successful scheme startup and the failed label, when fallback was required. */
export interface ConfigurationStartupResult {
  readonly scheme: ConfigurationScheme
  readonly recoveredFrom?: string
}

/**
 * Start a selected configuration and retry once with last-known-good.
 * @param options - Selected scheme, fallback identity, startup, and rollback operations.
 * @returns The scheme whose Host and renderer both reached readiness.
 * @throws The original failure for last-known-good, or both failures when rollback also fails.
 */
export async function startConfigurationWithFallback(
  options: ConfigurationStartupOptions,
): Promise<ConfigurationStartupResult> {
  try {
    await options.start(options.initial)
    return { scheme: options.initial }
  } catch (candidateCause) {
    if (candidateCause instanceof ConfigurationStartupCleanupError) throw candidateCause
    if (options.cancelled?.() === true) throw candidateCause
    if (options.initial.id === options.lastKnownGoodId) throw candidateCause
    let fallback: ConfigurationScheme
    try {
      fallback = options.rollback(options.initial)
    } catch (rollbackCause) {
      throw new AggregateError(
        [candidateCause, rollbackCause],
        `configuration scheme ${options.initial.label} failed and rollback could not be prepared`,
      )
    }
    try {
      await options.start(fallback)
    } catch (fallbackCause) {
      throw new AggregateError(
        [candidateCause, fallbackCause],
        `configuration schemes ${options.initial.label} and ${fallback.label} both failed to start`,
      )
    }
    return { scheme: fallback, recoveredFrom: options.initial.label }
  }
}
