import { describe, it, expect, vi } from 'vitest'
import { Cmd } from '../src/cmd.js'
import { Task } from '../src/task.js'
import type { Cmd as CmdType } from '../src/types.js'

type Msg = { kind: 'A' } | { kind: 'B'; n: number }

describe('Cmd constructors', () => {
  it('none is the None variant', () => {
    expect(Cmd.none).toEqual({ kind: 'None' })
  })

  it('effect wraps the function as data and does not call it', () => {
    const run = vi.fn()
    const cmd = Cmd.effect<Msg>(run)
    expect(cmd).toEqual({ kind: 'Effect', run })
    expect(run).not.toHaveBeenCalled()
  })

  it('map keeps the wrapping function as data', () => {
    const inner = Cmd.effect<number>(() => {})
    const f = (n: number): Msg => ({ kind: 'B', n })
    const mapped = Cmd.map(f, inner)
    expect(mapped).toEqual({ kind: 'Map', cmd: inner, f })
  })

  it('map over none is none', () => {
    expect(Cmd.map((n: number): Msg => ({ kind: 'B', n }), Cmd.none)).toBe(
      Cmd.none
    )
  })

  it('map over every variant produces Map (except None)', () => {
    const f = (n: number): Msg => ({ kind: 'B', n })
    const variants: CmdType<number>[] = [
      Cmd.effect(() => {}),
      Task.perform((n: number) => n, Task.succeed(1)),
      Task.attempt((r) => (r.kind === 'Ok' ? r.value : -1), Task.fail('e')),
      Cmd.batch(
        Cmd.effect(() => {}),
        Cmd.effect(() => {})
      ),
      Cmd.map(
        (s: string) => s.length,
        Cmd.effect(() => {})
      ),
    ]
    for (const v of variants) expect(Cmd.map(f, v).kind).toBe('Map')
  })
})

describe('Cmd.batch canonicalisation', () => {
  const e1 = Cmd.effect<Msg>(() => {})
  const e2 = Cmd.effect<Msg>(() => {})
  const e3 = Cmd.effect<Msg>(() => {})

  it('empty and all-None batches are none', () => {
    expect(Cmd.batch()).toBe(Cmd.none)
    expect(Cmd.batch(Cmd.none, Cmd.none)).toBe(Cmd.none)
    expect(Cmd.batch(Cmd.batch(), Cmd.batch(Cmd.none))).toBe(Cmd.none)
  })

  it('a single survivor is returned as itself', () => {
    expect(Cmd.batch(Cmd.none, e1, Cmd.none)).toBe(e1)
    expect(Cmd.batch(Cmd.batch(e1))).toBe(e1)
  })

  it('flattens nested batches and drops Nones, preserving order', () => {
    const cmd = Cmd.batch(e1, Cmd.none, Cmd.batch(e2, Cmd.batch(Cmd.none, e3)))
    expect(cmd).toEqual({ kind: 'Batch', cmds: [e1, e2, e3] })
  })

  it('does not flatten through Map', () => {
    const mapped = Cmd.map(
      (n: number): Msg => ({ kind: 'B', n }),
      Cmd.batch(Cmd.effect(() => {}))
    )
    const cmd = Cmd.batch(e1, mapped)
    expect(cmd).toEqual({ kind: 'Batch', cmds: [e1, mapped] })
  })
})

describe('Cmd is inert data', () => {
  it('nothing runs when a Cmd is built or batched or mapped', async () => {
    const effect = vi.fn()
    const work = vi.fn(async () => 1)
    Cmd.map(
      (n: number): Msg => ({ kind: 'B', n }),
      Cmd.batch(
        Cmd.effect(effect),
        Task.attempt(
          (r) => (r.kind === 'Ok' ? r.value : 0),
          Task.fromPromise(work, String)
        )
      )
    )
    await Promise.resolve()
    expect(effect).not.toHaveBeenCalled()
    expect(work).not.toHaveBeenCalled()
  })
})
