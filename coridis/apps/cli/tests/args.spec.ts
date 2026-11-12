import { describe, expect, it } from 'vitest'
import { parseArgs, UsageError } from '../src/args.ts'

describe('parseArgs', () => {
  it('parses the default invocation', () => {
    expect(parseArgs(['read', 'the', 'file'])).toEqual({
      mode: 'run',
      task: 'read the file',
      profile: 'headless',
      patches: [],
      json: false,
    })
  })

  it('parses profile, patches, and json forms', () => {
    expect(parseArgs([
      '--profile', 'dev',
      '--patch=a.yml',
      '--patch', 'b.yml',
      '--json',
      'go',
    ])).toEqual({
      mode: 'run',
      task: 'go',
      profile: 'dev',
      patches: ['a.yml', 'b.yml'],
      json: true,
    })

    expect(parseArgs(['--profile=prod', '--', '--not-a-flag'])).toEqual({
      mode: 'run',
      task: '--not-a-flag',
      profile: 'prod',
      patches: [],
      json: false,
    })
  })

  it('returns help or version from any position', () => {
    expect(parseArgs(['--help'])).toEqual({ mode: 'help' })
    expect(parseArgs(['task', '-h'])).toEqual({ mode: 'help' })
    expect(parseArgs(['--version', '--unknown'])).toEqual({ mode: 'version' })
  })

  it('rejects missing values, unknown options, and empty tasks', () => {
    expect(() => parseArgs([])).toThrow(UsageError)
    expect(() => parseArgs(['   '])).toThrow(/a task is required/)
    expect(() => parseArgs(['--unknown', 'task'])).toThrow(/unknown option: --unknown/)
    expect(() => parseArgs(['--profile'])).toThrow(/--profile requires a name/)
    expect(() => parseArgs(['--profile='])).toThrow(/--profile requires a name/)
    expect(() => parseArgs(['--patch'])).toThrow(/--patch requires a file/)
    expect(() => parseArgs(['--patch=', 'task'])).toThrow(/--patch requires a file/)
  })
})
