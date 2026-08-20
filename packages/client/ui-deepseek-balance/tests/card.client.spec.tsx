// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeepSeekBalanceCard, type DeepSeekBalanceCardProps } from '../src/client/DeepSeekBalanceCard.tsx'
import { zh } from '../src/client/locales.ts'

function response(total = 14.92, available = true): Response {
  return Response.json({
    ok: true,
    balance: {
      isAvailable: available,
      currency: 'CNY',
      totalBalance: total,
      grantedBalance: 4,
      toppedUpBalance: 10.92,
      updatedAt: '2026-08-16T08:30:00.000Z',
    },
  })
}

function props(wide = true, expandSidebar = vi.fn()): DeepSeekBalanceCardProps {
  return {
    wide,
    expandSidebar,
    t: ((key: keyof typeof zh, values?: Record<string, string>) => {
      let value: string = zh[key]
      for (const [name, replacement] of Object.entries(values ?? {})) value = value.replace(`{${name}}`, replacement)
      return value
    }) as DeepSeekBalanceCardProps['t'],
  } as DeepSeekBalanceCardProps
}

beforeEach(() => {
  document.documentElement.lang = 'zh-CN'
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('DeepSeek balance card', () => {
  it('renders authoritative balance parts and opens the official top-up launcher', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response()))
    render(<DeepSeekBalanceCard {...props()} />)
    expect(screen.getByText('正在读取余额')).toBeTruthy()
    expect(await screen.findByText('¥14.92')).toBeTruthy()
    expect(screen.getByText('¥10.92')).toBeTruthy()
    expect(screen.getByText('¥4.00')).toBeTruthy()
    expect(screen.getByText('账户可用')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '去充值' }))
    expect(screen.getByRole('dialog', { name: 'DeepSeek 充值' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'DeepSeek 官方充值页二维码' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /打开 DeepSeek 官网/ }).getAttribute('href'))
      .toBe('https://platform.deepseek.com/top_up')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'DeepSeek 充值' })).toBeNull()
  })

  it('marks low and unavailable balances without inventing usage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(1.5)))
    const low = render(<DeepSeekBalanceCard {...props()} />)
    expect(await screen.findByText('余额有点低')).toBeTruthy()
    low.unmount()

    vi.stubGlobal('fetch', vi.fn(async () => response(0, false)))
    render(<DeepSeekBalanceCard {...props()} />)
    expect(await screen.findByText('余额查询暂不可用')).toBeTruthy()
    expect(screen.queryByText(/已用/)).toBeNull()
  })

  it('shows a stable initial error and preserves stale data after refresh fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(Response.json({ ok: false, code: 'invalid_key' }))
    vi.stubGlobal('fetch', fetchMock)
    render(<DeepSeekBalanceCard {...props()} />)
    expect(await screen.findByText('¥14.92')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect((await screen.findByRole('alert')).textContent).toBe('API Key 无效，请到设置里检查')
    expect(screen.getByText('¥14.92')).toBeTruthy()
  })

  it('renders the missing-key state before any successful value', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: false, code: 'missing_key' })))
    render(<DeepSeekBalanceCard {...props()} />)
    expect(await screen.findByText('还没配置 DeepSeek API Key')).toBeTruthy()
  })

  it('contains an unexpected browser failure as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
    render(<DeepSeekBalanceCard {...props()} />)
    expect(await screen.findByText('余额暂时没取到')).toBeTruthy()
  })

  it('uses the rail control to expand and aborts an outstanding request on unmount', async () => {
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal as AbortSignal
      return await new Promise<Response>((_resolve, reject) => {
        signal!.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) })
      })
    }))
    const expand = vi.fn()
    const view = render(<DeepSeekBalanceCard {...props(false, expand)} />)
    fireEvent.click(screen.getByRole('button', { name: '查看 DeepSeek 余额' }))
    expect(expand).toHaveBeenCalledOnce()
    await waitFor(() => { expect(signal).toBeDefined() })
    view.unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => { await Promise.resolve() })
  })

  it('polls every minute without overlapping an in-flight request', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => await new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<DeepSeekBalanceCard {...props()} />)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('formats USD through the English locale branch', async () => {
    document.documentElement.lang = 'en'
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ok: true,
      balance: {
        isAvailable: true, currency: 'USD', totalBalance: 12, grantedBalance: 2,
        toppedUpBalance: 10, updatedAt: '2026-08-16T08:30:00.000Z',
      },
    })))
    render(<DeepSeekBalanceCard {...props()} />)
    expect(await screen.findByText('$12.00')).toBeTruthy()
  })
})
