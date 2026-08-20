// @vitest-environment jsdom
/** Mobile Skill, approval, and question interaction regressions. */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MuxFrame } from '@deepseek-ai/dsh-host-apiproxy/api/events'

vi.mock('@linxin666/dsh-remote-web-ui/src/mobile/api.ts', () => ({
  history: vi.fn(),
  listSessions: vi.fn(),
  listWorkspaces: vi.fn(),
  models: vi.fn(),
  prompt: vi.fn(),
  selectModel: vi.fn(),
  sendCommand: vi.fn(),
  skills: vi.fn(),
}))

vi.mock('@linxin666/dsh-remote-web-ui/src/mobile/rpc.ts', () => ({
  RpcCallError: class RpcCallError extends Error {},
  RpcTransportError: class RpcTransportError extends Error {},
  respondToRequest: vi.fn(),
}))

import {
  history, models, prompt, skills,
} from '@linxin666/dsh-remote-web-ui/src/mobile/api.ts'
import { respondToRequest } from '@linxin666/dsh-remote-web-ui/src/mobile/rpc.ts'
import { ChatView } from '@linxin666/dsh-remote-web-ui/src/mobile/views/ChatView.tsx'

const session = {
  sessionId: 'mobile-session',
  title: '手机会话',
  cwd: '/repo/app',
  updatedAt: 1,
  running: true,
  blank: false,
}

class FakeMux {
  private readonly listeners = new Set<(frame: MuxFrame, rpcId?: string) => void>()

  onFrame(listener: (frame: MuxFrame, rpcId?: string) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  emit(frame: MuxFrame, rpcId?: string): void {
    for (const listener of this.listeners) listener(frame, rpcId)
  }
}

const historyMock = vi.mocked(history)
const modelsMock = vi.mocked(models)
const promptMock = vi.mocked(prompt)
const skillsMock = vi.mocked(skills)
const respondMock = vi.mocked(respondToRequest)

beforeEach(() => {
  historyMock.mockResolvedValue({ events: [], hasMore: false })
  modelsMock.mockResolvedValue({
    current: { provider: 'deepseek', model: 'deepseek-chat' },
    routable: true,
    groups: [],
    failures: [],
  })
  promptMock.mockResolvedValue(undefined)
  skillsMock.mockResolvedValue([
    { name: 'gewu', description: '深入检查', modelInvocable: true },
    { name: 'manual-only', description: '只能手动选', modelInvocable: false },
  ])
  respondMock.mockResolvedValue({ accepted: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('mobile Skill picker', () => {
  it('loads the session-scoped catalog and inserts the literal slash gesture into the draft', async () => {
    render(<ChatView session={session} onBack={() => {}} />)

    fireEvent.click(await screen.findByRole('button', { name: /Skill/ }))
    const skill = await screen.findByRole('button', { name: /\/gewu/ })
    fireEvent.click(skill)

    expect(skillsMock).toHaveBeenCalledWith('mobile-session')
    expect(screen.getByPlaceholderText<HTMLTextAreaElement>(/输入消息/).value).toBe('/gewu ')
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/输入消息/)).toBe(document.activeElement)
    })
  })
})

describe('mobile chat header', () => {
  it('keeps a blank session titled as a new conversation', async () => {
    render(<ChatView session={{ ...session, title: '测试ds', blank: true }} onBack={() => {}} />)

    expect(await screen.findByRole('heading', { name: '新会话' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '测试ds' })).toBeNull()
  })
})

describe('mobile answerable interactions', () => {
  it('answers an approval with the server-request rpcId and waits for the resolved frame', async () => {
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} />)
    await screen.findByText('还没有消息，发一句话开始吧')

    await act(async () => {
      mux.emit({
        type: 'approval/requested',
        sessionId: 'mobile-session' as never,
        approvalId: 'approval-1' as never,
        toolName: 'bash',
        callId: 'call-1' as never,
        reason: '删除临时文件',
      }, 'approval-rpc')
    })

    expect(screen.queryByPlaceholderText(/输入消息/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '允许一次' }))
    await waitFor(() => {
      expect(respondMock).toHaveBeenCalledWith('approval-rpc', {
        ok: true,
        value: {
          sessionId: 'mobile-session',
          approvalId: 'approval-1',
          outcome: 'allowed-once',
        },
      })
    })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '等待主机确认…' }).disabled).toBe(true)

    await act(async () => {
      mux.emit({
        type: 'approval/resolved',
        sessionId: 'mobile-session' as never,
        approvalId: 'approval-1' as never,
        outcome: 'allowed-once',
      })
    })
    expect(await screen.findByPlaceholderText(/输入消息/)).toBeTruthy()
  })

  it('renders a question card and submits the structured answer batch with its rpcId', async () => {
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} />)
    await screen.findByText('还没有消息，发一句话开始吧')

    await act(async () => {
      mux.emit({
        type: 'question/requested',
        sessionId: 'mobile-session' as never,
        questions: [{
          id: 'choice',
          header: '确认',
          question: '选哪个方案？',
          options: [
            { label: '稳妥', description: '少改动' },
            { label: '激进', description: '改动更多' },
          ],
        }],
      }, 'question-rpc')
    })

    fireEvent.click(screen.getByRole('radio', { name: /稳妥/ }))
    fireEvent.click(screen.getByRole('button', { name: '提交回答' }))
    await waitFor(() => {
      expect(respondMock).toHaveBeenCalledWith('question-rpc', {
        ok: true,
        value: {
          sessionId: 'mobile-session',
          answer: { answers: [{ id: 'choice', selected: ['稳妥'] }] },
        },
      })
    })
  })
})
