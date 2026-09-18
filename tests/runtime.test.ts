import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { element } from '../src/runtime.js'
import { Cmd } from '../src/cmd.js'
import { Sub } from '../src/sub.js'
import { Task } from '../src/task.js'
import type {
  Cmd as CmdType,
  ErrorContext,
  Program,
  Sub as SubType,
} from '../src/types.js'

// --- a small counter program used throughout ------------------------------

type Model = { count: number; tickMs: number | null; log: string[] }
type Msg =
  | { kind: 'Inc' }
  | { kind: 'IncTwice' }
  | { kind: 'Tick' }
  | { kind: 'SetTick'; ms: number | null }
  | { kind: 'Got'; value: number }
  | { kind: 'Fetch'; task: 'ok' | 'fail' }
  | { kind: 'Throw' }
  | { kind: 'Log'; text: string }

const interval = (ms: number): SubType<Msg> =>
  Sub.fromSource<Msg, { ms: number }>(
    'interval',
    { ms },
    ({ ms }, dispatch) => {
      const id = setInterval(() => dispatch({ kind: 'Tick' }), ms)
      return () => clearInterval(id)
    }
  )

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const makeProgram = (
  overrides: Partial<Program<number, Model, Msg>> = {}
): Program<number, Model, Msg> => ({
  init: (start) => [{ count: start, tickMs: null, log: [] }, Cmd.none],
  update: (msg, model) => {
    switch (msg.kind) {
      case 'Inc':
        return [{ ...model, count: model.count + 1 }, Cmd.none]
      case 'IncTwice':
        return [
          model,
          Cmd.effect((dispatch) => {
            dispatch({ kind: 'Inc' })
            dispatch({ kind: 'Inc' })
          }),
        ]
      case 'Tick':
        return [{ ...model, count: model.count + 10 }, Cmd.none]
      case 'SetTick':
        return [{ ...model, tickMs: msg.ms }, Cmd.none]
      case 'Got':
        return [{ ...model, count: msg.value }, Cmd.none]
      case 'Fetch':
        return [
          model,
          msg.task === 'ok'
            ? Task.perform(
                (value: number) => ({ kind: 'Got', value }) as Msg,
                Task.succeed(42)
              )
            : Task.perform(
                (value: number) => ({ kind: 'Got', value }) as Msg,
                Task.fromPromise(async () => {
                  throw new Error('network')
                }, String) as never
              ),
        ]
      case 'Throw':
        throw new Error('update exploded')
      case 'Log':
        return [{ ...model, log: [...model.log, msg.text] }, Cmd.none]
    }
  },
  subscriptions: (model) =>
    model.tickMs === null ? Sub.none : interval(model.tickMs),
  view: () => {},
  ...overrides,
})

describe('element start-up', () => {
  it('passes flags to init, renders once, and performs the initial Cmd', () => {
    const view = vi.fn()
    const effect = vi.fn()
    const program = makeProgram({
      init: (start) => [
        { count: start, tickMs: null, log: [] },
        Cmd.effect(effect),
      ],
      view,
    })
    element({ program, flags: 7 })
    expect(view).toHaveBeenCalledTimes(1)
    expect(view.mock.calls[0]![0]).toEqual({ count: 7, tickMs: null, log: [] })
    expect(effect).toHaveBeenCalledTimes(1)
  })

  it('rethrows when init throws', () => {
    const program = makeProgram({
      init: () => {
        throw new Error('no model')
      },
    })
    expect(() => element({ program, onError: () => {} })).toThrow('no model')
  })

  it('messages dispatched during the initial Cmd are processed after start-up, in order', () => {
    const seen: number[] = []
    const program = makeProgram({
      init: (start) => [
        { count: start, tickMs: null, log: [] },
        Cmd.effect((dispatch) => {
          dispatch({ kind: 'Inc' })
          dispatch({ kind: 'Inc' })
        }),
      ],
      view: (model) => {
        seen.push(model.count)
      },
    })
    element({ program, flags: 0 })
    expect(seen).toEqual([0, 1, 2])
  })
})

describe('element update loop', () => {
  it('calls view after every update with the new model', () => {
    const seen: number[] = []
    const app = element({
      program: makeProgram({ view: (m) => void seen.push(m.count) }),
      flags: 0,
    })
    app.dispatch({ kind: 'Inc' })
    app.dispatch({ kind: 'Inc' })
    expect(seen).toEqual([0, 1, 2])
  })

  it('queues re-entrant dispatches and processes them in order, not recursively', () => {
    const order: string[] = []
    const program = makeProgram({
      update: (msg, model) => {
        order.push(`update:${msg.kind}`)
        return makeProgram().update(msg, model)
      },
      view: (model) => {
        order.push(`view:${model.count}`)
      },
    })
    const app = element({ program, flags: 0 })
    order.length = 0
    app.dispatch({ kind: 'IncTwice' })
    expect(order).toEqual([
      'update:IncTwice',
      'view:0',
      'update:Inc',
      'view:1',
      'update:Inc',
      'view:2',
    ])
  })

  it('a dispatch from inside view is queued', () => {
    let once = false
    const seen: number[] = []
    const program = makeProgram({
      view: (model, dispatch) => {
        seen.push(model.count)
        if (!once) {
          once = true
          dispatch({ kind: 'Inc' })
        }
      },
    })
    element({ program, flags: 0 })
    expect(seen).toEqual([0, 1])
  })

  it('delivers a performed task result as a Msg', async () => {
    const seen: number[] = []
    const app = element({
      program: makeProgram({ view: (m) => void seen.push(m.count) }),
      flags: 0,
    })
    app.dispatch({ kind: 'Fetch', task: 'ok' })
    await flush()
    expect(seen).toEqual([0, 0, 42])
  })
})

describe('element subscriptions', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('starts, restarts on params change, and tears down', () => {
    const seen: number[] = []
    const app = element({
      program: makeProgram({ view: (m) => void seen.push(m.count) }),
      flags: 0,
    })
    expect(vi.getTimerCount()).toBe(0)

    app.dispatch({ kind: 'SetTick', ms: 100 })
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(250)
    expect(seen.at(-1)).toBe(20)

    app.dispatch({ kind: 'SetTick', ms: 1000 }) // params changed → restarted
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(250)
    expect(seen.at(-1)).toBe(20)
    vi.advanceTimersByTime(750)
    expect(seen.at(-1)).toBe(30)

    app.dispatch({ kind: 'Inc' }) // same key, same params → left running
    vi.advanceTimersByTime(1000)
    expect(seen.at(-1)).toBe(41)

    app.dispatch({ kind: 'SetTick', ms: null })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not restart a subscription when params are structurally equal', () => {
    const start = vi.fn(() => () => {})
    const program = makeProgram({
      subscriptions: () => Sub.fromSource('s', { a: [1, { b: 2 }] }, start),
    })
    const app = element({ program, flags: 0 })
    app.dispatch({ kind: 'Inc' })
    app.dispatch({ kind: 'Inc' })
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('namespaced subscriptions from Sub.map are independent', () => {
    const starts: string[] = []
    const src = (key: string) =>
      Sub.fromSource<string, null>(key, null, () => {
        starts.push(key)
        return () => {}
      })
    const program = makeProgram({
      subscriptions: () =>
        Sub.batch(
          Sub.map('left', (): Msg => ({ kind: 'Inc' }), src('tick')),
          Sub.map('right', (): Msg => ({ kind: 'Inc' }), src('tick'))
        ),
    })
    element({ program, flags: 0 })
    expect(starts).toEqual(['tick', 'tick'])
  })
})

describe('element stop', () => {
  it('tears down subscriptions and ignores later dispatches', () => {
    vi.useFakeTimers()
    const view = vi.fn()
    const app = element({ program: makeProgram({ view }), flags: 0 })
    app.dispatch({ kind: 'SetTick', ms: 10 })
    expect(vi.getTimerCount()).toBe(1)
    app.stop()
    expect(vi.getTimerCount()).toBe(0)
    const calls = view.mock.calls.length
    app.dispatch({ kind: 'Inc' })
    expect(view.mock.calls.length).toBe(calls)
    vi.useRealTimers()
  })

  it('aborts in-flight tasks: no Msg arrives after stop', async () => {
    const seen: number[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const program = makeProgram({
      view: (m) => void seen.push(m.count),
      init: () => [
        { count: 0, tickMs: null, log: [] },
        Task.perform(
          (value: number): Msg => ({ kind: 'Got', value }),
          Task.fromPromise(async (signal) => {
            expect(signal.aborted).toBe(false)
            await gate
            return 99
          }, String) as never
        ),
      ],
    })
    const app = element({ program })
    app.stop()
    release()
    await flush()
    expect(seen).toEqual([0])
  })

  it('hands the program signal to tasks so they can cancel their own work', () => {
    const box: { signal?: AbortSignal } = {}
    const program = makeProgram({
      init: () => [
        { count: 0, tickMs: null, log: [] },
        Task.attempt(
          (): Msg => ({ kind: 'Inc' }),
          Task.fromPromise((signal) => {
            box.signal = signal
            return new Promise<number>(() => {})
          }, String)
        ),
      ],
    })
    const app = element({ program })
    expect(box.signal?.aborted).toBe(false)
    app.stop()
    expect(box.signal?.aborted).toBe(true)
  })
})

describe('element error handling', () => {
  it('update throw: onError gets step and msg, model unchanged, loop continues', () => {
    const seen: number[] = []
    const errors: ErrorContext<Msg>[] = []
    const app = element({
      program: makeProgram({ view: (m) => void seen.push(m.count) }),
      flags: 5,
      onError: (_error, context) => void errors.push(context),
    })
    app.dispatch({ kind: 'Throw' })
    expect(errors).toEqual([{ step: 'update', msg: { kind: 'Throw' } }])
    expect(seen).toEqual([5]) // no re-render for the failed step
    app.dispatch({ kind: 'Inc' })
    expect(seen).toEqual([5, 6])
  })

  it('rethrows out of dispatch when no onError is given, and keeps working afterwards', () => {
    const seen: number[] = []
    const app = element({
      program: makeProgram({ view: (m) => void seen.push(m.count) }),
      flags: 0,
    })
    expect(() => app.dispatch({ kind: 'Throw' })).toThrow('update exploded')
    app.dispatch({ kind: 'Inc' })
    expect(seen).toEqual([0, 1])
  })

  it('view throw is reported and the updated model is kept', () => {
    const errors: ErrorContext<Msg>[] = []
    const seen: number[] = []
    let calls = 0
    const app = element({
      program: makeProgram({
        view: (m) => {
          if (++calls === 2) throw new Error('render')
          seen.push(m.count)
        },
      }),
      flags: 0,
      onError: (_e, c) => void errors.push(c),
    })
    app.dispatch({ kind: 'Inc' }) // view throws on this render
    expect(errors).toEqual([{ step: 'view', msg: { kind: 'Inc' } }])
    app.dispatch({ kind: 'Inc' })
    expect(seen).toEqual([0, 2]) // the update that preceded the failing view was kept
    expect(errors).toHaveLength(1)
  })

  it('subscriptions / sub-start / sub-teardown / effect are reported with their step', () => {
    const errors: string[] = []
    let phase: 'subs' | 'start' | 'teardown' | 'ok' = 'ok'
    const program = makeProgram({
      subscriptions: () => {
        if (phase === 'subs') throw new Error('subs')
        if (phase === 'ok') return Sub.none
        return Sub.fromSource('s', phase, () => {
          if (phase === 'start') throw new Error('start')
          return () => {
            throw new Error('teardown')
          }
        })
      },
    })
    const app = element({
      program,
      flags: 0,
      onError: (_e, c) => void errors.push(c.step),
    })
    phase = 'subs'
    app.dispatch({ kind: 'Inc' })
    phase = 'start'
    app.dispatch({ kind: 'Inc' })
    phase = 'teardown'
    app.dispatch({ kind: 'Inc' }) // starts fine (params changed from 'start' to 'teardown')
    phase = 'ok'
    app.dispatch({ kind: 'Inc' }) // tears down → throws
    app.dispatch({ kind: 'IncTwice' })
    expect(errors).toEqual(['subscriptions', 'sub-start', 'sub-teardown'])

    const effectErrors: string[] = []
    const app2 = element({
      program: makeProgram({
        update: () => [
          { count: 0, tickMs: null, log: [] },
          Cmd.effect(() => {
            throw new Error('effect')
          }),
        ],
      }),
      flags: 0,
      onError: (_e, c) => void effectErrors.push(c.step),
    })
    app2.dispatch({ kind: 'Inc' })
    expect(effectErrors).toEqual(['effect'])
  })

  it('a failing performed task is routed to onError with step perform', async () => {
    const errors: ErrorContext<Msg>[] = []
    const seen: number[] = []
    const app = element({
      program: makeProgram({ view: (m) => void seen.push(m.count) }),
      flags: 0,
      onError: (_e, c) => void errors.push(c),
    })
    app.dispatch({ kind: 'Fetch', task: 'fail' })
    await flush()
    expect(errors).toEqual([
      { step: 'perform', msg: { kind: 'Fetch', task: 'fail' } },
    ])
    expect(seen).toEqual([0, 0])
  })
})
