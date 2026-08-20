import { describe, expect, it } from 'vitest'
import { realizeSeedFixture, type WebScaffold } from './scaffold.ts'

describe('web scaffold fixture portability', () => {
  it('realizes cwd placeholders as valid JSON for Windows workspaces', () => {
    const scaffold = { workspaceCwd: String.raw`C:\Users\runneradmin\AppData\Local\Temp\dsh-web` } as WebScaffold
    const fixture = [
      JSON.stringify({ type: 'session', id: '{{sessionId}}', cwd: '{{cwd}}/workspace' }),
      JSON.stringify({ type: 'message', path: '{{cwd}}/artifact.txt' }),
    ].join('\n')

    const realized = realizeSeedFixture(scaffold, fixture, 'windows-seed')
    const lines = realized.split('\n').map(line => JSON.parse(line) as Record<string, string>)

    expect(lines).toEqual([
      { type: 'session', id: 'windows-seed', cwd: scaffold.workspaceCwd },
      { type: 'message', path: `${scaffold.workspaceCwd}/artifact.txt` },
    ])
  })

  it('rewrites an existing recorded cwd without corrupting Windows JSON escapes', () => {
    const scaffold = { workspaceCwd: String.raw`C:\Users\runneradmin\AppData\Local\Temp\dsh-web` } as WebScaffold
    const recordedCwd = '/tmp/recorded-workspace'
    const fixture = [
      JSON.stringify({ type: 'session', id: '{{sessionId}}', cwd: recordedCwd }),
      JSON.stringify({ type: 'message', path: `${recordedCwd}/artifact.txt` }),
    ].join('\n')

    const realized = realizeSeedFixture(scaffold, fixture, 'windows-seed')
    const lines = realized.split('\n').map(line => JSON.parse(line) as Record<string, string>)

    expect(lines).toEqual([
      { type: 'session', id: 'windows-seed', cwd: scaffold.workspaceCwd },
      { type: 'message', path: `${scaffold.workspaceCwd}/artifact.txt` },
    ])
  })
})
