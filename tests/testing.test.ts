import { describe, it, expect, vi } from 'vitest'
import { flattenCmd, runCmd, CmdError, flattenSubs } from '../src/testing.js'
import { Cmd } from '../src/cmd.js'
import { Sub } from '../src/sub.js'
import { Task } from '../src/task.js'
import { Ok, Err } from '../src/result.js'

type Msg =
  | { kind: 'N'; n: number }
  | { kind: 'S'; s: string }
  | { kind: 'R'; ok: boolean }

const toN = (n: number): Msg => ({ kind: 'N', n })

describe('flattenCmd', () => {
  it('drops None and splices batches, preserving order', () => {
    const a = Cmd.effect<Msg>(() => {})
    const b = Cmd.effect<Msg>(() => {})
    const leaves = flattenCmd(Cmd.batch(Cmd.none, a, Cmd.batch(b, Cmd.none)))
    expect(leaves.map((l) => l.kind)).toEqual(['Effect', 'Effect'])
    expect(flattenCmd(Cmd.none)).toEqual([])
  })

  it('composes Map into each leaf', async () => {
    const cmd = Cmd.map(
      (s: string): Msg => ({ kind: 'S', s: s.toUpperCase() }),
      Cmd.map(
        (n: number) => `n${n}`,
        Cmd.batch(
          Task.perform((n: number) => n, Task.succeed(1)),
          Task.attempt((r) => (r.kind === 'Ok' ? r.value : -1), Task.fail('e')),
          Cmd.effect<number>((dispatch) => dispatch(3))
        )
      )
    )
    const [perform, attempt, effect] = flattenCmd(cmd)
    expect(perform?.kind).toBe('Perform')
    expect(attempt?.kind).toBe('Attempt')
    expect(effect?.kind).toBe('Effect')
    if (perform?.kind === 'Perform')
      expect(perform.toMsg(1)).toEqual({ kind: 'S', s: 'N1' })
    if (attempt?.kind === 'Attempt')
      expect(attempt.toMsg(Err('e'))).toEqual({ kind: 'S', s: 'N-1' })
    if (effect?.kind === 'Effect') {
      const out: Msg[] = []
      effect.run((m) => out.push(m))
      expect(out).toEqual([{ kind: 'S', s: 'N3' }])
    }
  })
})

describe('runCmd', () => {
  it('collects messages from effects and tasks, in dispatch order', async () => {
    const cmd = Cmd.batch<Msg>(
      Cmd.effect((dispatch) => dispatch({ kind: 'S', s: 'first' })),
      Task.perform(toN, Task.succeed(1)),
      Task.attempt((r) => ({ kind: 'R', ok: r.kind === 'Ok' }), Task.fail('e')),
      Task.attempt((r) => ({ kind: 'R', ok: r.kind === 'Ok' }), Task.succeed(2))
    )
    expect(await runCmd(cmd)).toEqual([
      { kind: 'S', s: 'first' },
      { kind: 'N', n: 1 },
      { kind: 'R', ok: false },
      { kind: 'R', ok: true },
    ])
  })

  it('resolves to [] for Cmd.none and forwards to a provided dispatch', async () => {
    expect(await runCmd(Cmd.none)).toEqual([])
    const dispatch = vi.fn()
    await runCmd(Task.perform(toN, Task.succeed(5)), { dispatch })
    expect(dispatch).toHaveBeenCalledWith({ kind: 'N', n: 5 })
  })

  it('rejects with a CmdError carrying the step and cause', async () => {
    const boom = new Error('boom')
    const cmd = Cmd.effect<Msg>(() => {
      throw boom
    })
    const err = await runCmd(cmd).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CmdError)
    expect((err as CmdError).step).toBe('effect')
    expect((err as CmdError).cause).toBe(boom)
  })

  it('reports a failing performed task at step perform', async () => {
    const cmd = Task.perform(
      toN,
      Task.fromPromise(async () => {
        throw new Error('net')
      }, String) as never
    )
    await expect(runCmd(cmd)).rejects.toMatchObject({ step: 'perform' })
  })

  it('honours an aborted signal: nothing is dispatched', async () => {
    const controller = new AbortController()
    controller.abort()
    const cmd = Cmd.batch<Msg>(
      Task.perform(toN, Task.succeed(1)),
      Task.attempt(() => toN(2), Task.succeed(2))
    )
    expect(await runCmd(cmd, { signal: controller.signal })).toEqual([])
  })
})

describe('flattenSubs re-export', () => {
  it('is the same helper as sub.ts', () => {
    const s = Sub.fromSource<Msg, null>('k', null, () => () => {})
    expect(flattenSubs(Sub.batch(s, Sub.none))).toEqual([s])
  })
})

describe('Ok/Err in toMsg', () => {
  it('attempt delivers the Result unchanged', async () => {
    const msgs = await runCmd(Task.attempt((r) => r, Task.succeed('v')))
    expect(msgs).toEqual([Ok('v')])
  })
})
