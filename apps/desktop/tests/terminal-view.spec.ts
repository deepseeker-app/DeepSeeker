import { describe, expect, it } from 'vitest'
import { terminalDocument } from '../src/terminal-view.ts'

describe('desktop terminal document', () => {
  it('is script-free, CSP-restricted, styled, and escapes the scheme label', () => {
    const html = terminalDocument('本机终端 · <工作&测试>', '.xterm { position: relative; }')

    expect(html).toContain("default-src 'none'")
    expect(html).toContain('form-action \'none\'')
    expect(html).not.toMatch(/<script/iu)
    expect(html).toContain('.xterm { position: relative; }')
    expect(html).toContain('本机终端 · &lt;工作&amp;测试&gt;')
    expect(html).toContain('id="terminal"')
    expect(html).toContain('id="terminal-status"')
  })

  it('rejects a stylesheet that could escape its trusted style element', () => {
    expect(() => terminalDocument('终端', '</style><script>alert(1)</script>')).toThrow('closing style tag')
  })
})
