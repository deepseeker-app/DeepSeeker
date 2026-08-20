// @vitest-environment jsdom
/** The phone keeps its scarce HTTP connection free until chat needs live events. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const muxInstances = vi.hoisted(() => [] as Array<{
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  observe: ReturnType<typeof vi.fn>
}>)

vi.mock('@linxin666/dsh-remote-web-ui/src/mobile/mux.ts', () => ({
  MuxClient: class MuxClient {
    readonly start = vi.fn()
    readonly stop = vi.fn()
    readonly observe = vi.fn()

    constructor() {
      muxInstances.push(this)
    }
  },
}))

vi.mock('@linxin666/dsh-remote-web-ui/src/mobile/views/WorkspaceView.tsx', () => ({
  WorkspaceView: ({ onPick }: { onPick: (workspace: unknown) => void }) => (
    <button type="button" onClick={() => {
      onPick({
        workspaceId: 'workspace-1',
        path: '/tmp/project',
        title: '测试项目',
        sessionIds: ['session-1'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
    }}>
      打开工作区
    </button>
  ),
}))

vi.mock('@linxin666/dsh-remote-web-ui/src/mobile/views/SessionListView.tsx', () => ({
  SessionListView: ({ onBack, onPick }: { onBack: () => void; onPick: (session: unknown) => void }) => (
    <>
      <button type="button" onClick={onBack}>返回工作区</button>
      <button type="button" onClick={() => {
        onPick({
          sessionId: 'session-1',
          title: '测试会话',
          updatedAt: 1,
          running: false,
          blank: false,
        })
      }}>
        打开会话
      </button>
    </>
  ),
}))

vi.mock('@linxin666/dsh-remote-web-ui/src/mobile/views/ChatView.tsx', () => ({
  ChatView: ({ onBack }: { onBack: () => void }) => (
    <>
      <p>聊天页</p>
      <button type="button" onClick={onBack}>返回会话</button>
    </>
  ),
}))

import { App } from '@linxin666/dsh-remote-web-ui/src/mobile/views/App.tsx'

afterEach(() => {
  cleanup()
  muxInstances.length = 0
  vi.clearAllMocks()
})

describe('mobile live-stream lifecycle', () => {
  it('opens the mux only for chat and releases it when chat closes', async () => {
    render(<App />)

    expect(muxInstances).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '打开工作区' }))
    expect(muxInstances).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: '打开会话' }))
    expect(await screen.findByText('聊天页')).toBeTruthy()
    expect(muxInstances).toHaveLength(1)
    await waitFor(() => {
      expect(muxInstances[0]?.start).toHaveBeenCalledOnce()
      expect(muxInstances[0]?.observe).toHaveBeenCalledWith('session-1')
    })

    fireEvent.click(screen.getByRole('button', { name: '返回会话' }))
    expect(await screen.findByRole('button', { name: '打开会话' })).toBeTruthy()
    expect(muxInstances[0]?.stop).toHaveBeenCalledOnce()
  })
})
