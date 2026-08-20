// @vitest-environment jsdom
/** Remote read-only behavior for the patched Git branch popover. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { BranchPopover } from '@linxin666/dsh-client-ui-git-graph/src/client/chips/BranchPopover.tsx'
import { zh, type GitGraphKey } from '@linxin666/dsh-client-ui-git-graph/src/client/locales.ts'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'

const t = ((key: GitGraphKey) => zh[key]) as Translate<GitGraphKey>

afterEach(() => { cleanup() })

describe('Git graph remote UI', () => {
  it('keeps inspection available without rendering repository mutations', () => {
    const onSwitch = vi.fn(async () => ({ ok: true as const, branch: 'feature' }))
    const onCreate = vi.fn()
    const onGraph = vi.fn()

    render(<BranchPopover
      view={{
        root: '/workspace',
        branch: 'main',
        dirtyFiles: 0,
        untrackedFiles: 0,
        conflicts: 0,
        operationInProgress: false,
        branches: [
          { name: 'main', current: true },
          { name: 'feature', current: false },
        ],
      }}
      readOnly
      onSwitch={onSwitch}
      onSwitched={vi.fn()}
      onCreate={onCreate}
      onGraph={onGraph}
      onClose={vi.fn()}
      t={t}
    />)

    expect(screen.getByText(zh['branch.remoteReadOnly'])).toBeTruthy()
    expect(screen.queryByText(zh['branch.create'])).toBeNull()

    const feature = screen.getByRole('option', { name: 'feature' }) as HTMLButtonElement
    expect(feature.disabled).toBe(true)
    fireEvent.click(feature)
    expect(onSwitch).not.toHaveBeenCalled()
    expect(onCreate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: zh['branch.graph'] }))
    expect(onGraph).toHaveBeenCalledOnce()
  })
})
