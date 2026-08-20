import { describe, expect, it } from 'vitest'
import {
  configurationSchemeDocument,
  parseConfigurationSchemeAction,
} from '../src/configuration-scheme-view.ts'

describe('configuration-scheme manager document', () => {
  it('renders escaped names with no preload or inline JavaScript dependency', () => {
    const html = configurationSchemeDocument([
      { id: 'default', label: '默认', harnessHome: '/tmp/default', builtIn: true },
      { id: 'scheme-123', label: '<工作&测试>', harnessHome: '/tmp/work', builtIn: false },
    ], 'default')

    expect(html).toContain('&lt;工作&amp;测试&gt;')
    expect(html).toContain('每套方案都有自己的模型、密钥、插件和会话')
    expect(html).not.toContain('<script')
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('/configuration-schemes/delete?id=scheme-123')
  })

  it('accepts only the fixed native action origin and known operations', () => {
    expect(parseConfigurationSchemeAction(
      'https://deepseeker.local/configuration-schemes/create?label=%E5%B7%A5%E4%BD%9C',
    )).toEqual({ type: 'create', label: '工作' })
    expect(parseConfigurationSchemeAction(
      'https://deepseeker.local/configuration-schemes/rename?id=abc&label=personal',
    )).toEqual({ type: 'rename', id: 'abc', label: 'personal' })
    expect(parseConfigurationSchemeAction(
      'https://deepseeker.local/configuration-schemes/select?id=abc',
    )).toEqual({ type: 'select', id: 'abc' })
    expect(parseConfigurationSchemeAction(
      'https://deepseeker.local/configuration-schemes/delete?id=abc',
    )).toEqual({ type: 'delete', id: 'abc' })
    expect(parseConfigurationSchemeAction('https://evil.example/configuration-schemes/create?label=x')).toBeNull()
    expect(parseConfigurationSchemeAction('https://deepseeker.local/other')).toBeNull()
  })
})
