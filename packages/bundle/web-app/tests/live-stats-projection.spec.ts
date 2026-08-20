/** The bundled live-stats projection must remain persistable across every step phase. */

import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { snapshotJsonValue, type SessionEvent } from '@deepseek-ai/dsh-session'
import {
  createLiveTokenUsageProjectionDefinition,
  resolveEstimatorConfig,
} from '@linxin666/dsh-live-stats'

const event = (value: SessionEvent): SessionEvent => value

describe('bundled live-stats projection checkpoint', () => {
  it('keeps initial, sparse streaming, and settled state losslessly JSON-serializable', () => {
    const projection = createLiveTokenUsageProjectionDefinition(resolveEstimatorConfig({}))
    let state = projection.init()

    expect(snapshotJsonValue(state)).toEqual(state)

    state = projection.apply(state, event({
      type: 'user/message',
      seq: 0,
      time: 1_000,
      data: createUserMessage({
        content: [{ type: 'text', text: 'Keep this checkpoint after restart.' }],
        source: { kind: 'user' },
      }),
      surfaceOp: 'append',
    }))
    state = projection.apply(state, event({
      type: 'step/start',
      seq: 1,
      time: 1_100,
      data: { turn: 1, step: 1 },
    }))
    state = projection.apply(state, event({
      type: 'assistant/chunk',
      seq: 2,
      time: 1_200,
      data: {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 4, text: 'sparse output' },
      },
    }))

    expect(snapshotJsonValue(state)).toEqual(state)

    state = projection.apply(state, event({
      type: 'step/end',
      seq: 3,
      time: 1_200,
      data: { turn: 1, step: 1 },
    }))

    expect(snapshotJsonValue(state)).toEqual(state)
    expect(projection.stateVersion).toBe(3)
  })
})
