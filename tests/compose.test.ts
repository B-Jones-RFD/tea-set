import { describe, it, expect, vi } from 'vitest'
import {
  Internal,
  External,
  raise,
  translate,
  delegate,
  updateChild,
} from '../src/compose.js'
import { Cmd } from '../src/cmd.js'
import { Task } from '../src/task.js'
import type { ChildMsg, Cmd as CmdType, Translator } from '../src/types.js'

// --- A child module. It knows nothing about any parent. ---------------------

type CounterModel = { count: number; limit: number }
type CounterInternal = { kind: 'Increment' } | { kind: 'Reset' }
type CounterExternal = { kind: 'LimitReached'; count: number }
type CounterMsg = ChildMsg<CounterInternal, CounterExternal>

const Counter = {
  init: (limit: number): CounterModel => ({ count: 0, limit }),
  update(
    msg: CounterMsg,
    model: CounterModel
  ): [CounterModel, CmdType<CounterMsg>] {
    // External events are for the parent; a child leaves them alone.
    if (msg.kind === 'External') return [model, Cmd.none]
    switch (msg.msg.kind) {
      case 'Increment': {
        const count = model.count + 1
        const cmd: CmdType<CounterMsg> =
          count >= model.limit
            ? raise({ kind: 'LimitReached', count })
            : Cmd.none
        return [{ ...model, count }, cmd]
      }
      case 'Reset':
        return [{ ...model, count: 0 }, Cmd.none]
    }
  },
}

// --- A parent module. ------------------------------------------------------

type ParentModel = { left: CounterModel; right: CounterModel; alerts: string[] }
type ParentMsg =
  | { kind: 'LeftMsg'; msg: CounterMsg }
  | { kind: 'RightMsg'; msg: CounterMsg }
  | { kind: 'Alert'; text: string }

const leftTranslator: Translator<CounterInternal, CounterExternal, ParentMsg> =
  {
    onInternal: (msg) => ({ kind: 'LeftMsg', msg: Internal(msg) }),
    onExternal: (ev) => ({ kind: 'Alert', text: `left hit ${ev.count}` }),
  }

/** Perform an Effect-only Cmd synchronously, collecting messages. */
const collect = <Msg>(cmd: CmdType<Msg>): Msg[] => {
  const out: Msg[] = []
  const walk = <A>(c: CmdType<A>, emit: (a: A) => void): void => {
    switch (c.kind) {
      case 'None':
        return
      case 'Batch':
        c.cmds.forEach((x) => walk(x, emit))
        return
      case 'Map':
        walk(c.cmd, (a) => emit(c.f(a)))
        return
      case 'Effect':
        c.run(emit)
        return
      default:
        throw new Error(`collect: unexpected ${c.kind}`)
    }
  }
  walk(cmd, (m) => out.push(m))
  return out
}

describe('Internal / External', () => {
  it('build tagged data', () => {
    expect(Internal({ kind: 'Increment' })).toEqual({
      kind: 'Internal',
      msg: { kind: 'Increment' },
    })
    expect(External('done')).toEqual({ kind: 'External', msg: 'done' })
  })
})

describe('raise', () => {
  it('builds an Effect that dispatches the External event', () => {
    const cmd = raise<CounterInternal, CounterExternal>({
      kind: 'LimitReached',
      count: 9,
    })
    expect(cmd.kind).toBe('Effect')
    expect(collect(cmd)).toEqual([External({ kind: 'LimitReached', count: 9 })])
  })
})

describe('translate', () => {
  const toParent = translate(leftTranslator)

  it('routes Internal through onInternal', () => {
    expect(toParent(Internal({ kind: 'Reset' }))).toEqual({
      kind: 'LeftMsg',
      msg: { kind: 'Internal', msg: { kind: 'Reset' } },
    })
  })

  it('routes External through onExternal', () => {
    expect(toParent(External({ kind: 'LimitReached', count: 3 }))).toEqual({
      kind: 'Alert',
      text: 'left hit 3',
    })
  })
})

describe('delegate', () => {
  it('passes the model through and maps the Cmd', () => {
    const toParent = translate(leftTranslator)
    const [model, cmd] = delegate(
      toParent,
      Counter.update(Internal({ kind: 'Increment' }), { count: 1, limit: 2 })
    )
    expect(model).toEqual({ count: 2, limit: 2 })
    expect(cmd.kind).toBe('Map')
    expect(collect(cmd)).toEqual([{ kind: 'Alert', text: 'left hit 2' }])
  })

  it('leaves Cmd.none as none', () => {
    const [, cmd] = delegate(
      translate(leftTranslator),
      Counter.update(Internal({ kind: 'Reset' }), Counter.init(5))
    )
    expect(cmd).toBe(Cmd.none)
  })

  it('works with any Cmd variant, not only Effect', () => {
    const [, cmd] = delegate(
      (n: number): ParentMsg => ({ kind: 'Alert', text: String(n) }),
      [null, Task.perform((n: number) => n, Task.succeed(1))]
    )
    expect(cmd.kind).toBe('Map')
  })
})

describe('updateChild', () => {
  const left = updateChild<
    ParentModel,
    ParentMsg,
    CounterModel,
    CounterInternal,
    CounterExternal
  >({
    get: (p) => p.left,
    set: (p, left) => ({ ...p, left }),
    translator: leftTranslator,
    update: Counter.update,
  })
  const right = updateChild<
    ParentModel,
    ParentMsg,
    CounterModel,
    CounterInternal,
    CounterExternal
  >({
    get: (p) => p.right,
    set: (p, right) => ({ ...p, right }),
    translator: {
      onInternal: (msg) => ({ kind: 'RightMsg', msg: Internal(msg) }),
      onExternal: (ev) => ({ kind: 'Alert', text: `right hit ${ev.count}` }),
    },
    update: Counter.update,
  })

  const Parent = {
    init: (): ParentModel => ({
      left: Counter.init(2),
      right: Counter.init(3),
      alerts: [],
    }),
    update(
      msg: ParentMsg,
      model: ParentModel
    ): [ParentModel, CmdType<ParentMsg>] {
      switch (msg.kind) {
        case 'LeftMsg':
          return left(msg.msg, model)
        case 'RightMsg':
          return right(msg.msg, model)
        case 'Alert':
          return [{ ...model, alerts: [...model.alerts, msg.text] }, Cmd.none]
      }
    },
  }

  it('updates only the addressed child and lifts its model into the parent', () => {
    const [m1, c1] = Parent.update(
      { kind: 'LeftMsg', msg: Internal({ kind: 'Increment' }) },
      Parent.init()
    )
    expect(m1.left.count).toBe(1)
    expect(m1.right.count).toBe(0)
    expect(c1).toBe(Cmd.none)
  })

  it('translates a child External event into a parent Msg that the parent then handles', () => {
    const [m1] = Parent.update(
      { kind: 'LeftMsg', msg: Internal({ kind: 'Increment' }) },
      Parent.init()
    )
    const [m2, c2] = Parent.update(
      { kind: 'LeftMsg', msg: Internal({ kind: 'Increment' }) },
      m1
    )
    expect(m2.left.count).toBe(2)
    const raised = collect(c2)
    expect(raised).toEqual([{ kind: 'Alert', text: 'left hit 2' }])
    const [m3] = Parent.update(raised[0]!, m2)
    expect(m3.alerts).toEqual(['left hit 2'])
  })

  it('two instances of the same child stay independent', () => {
    let model = Parent.init()
    for (let i = 0; i < 3; i++) {
      ;[model] = Parent.update(
        { kind: 'RightMsg', msg: Internal({ kind: 'Increment' }) },
        model
      )
    }
    expect(model.right.count).toBe(3)
    expect(model.left.count).toBe(0)
  })

  it('does not call get/set until invoked', () => {
    const get = vi.fn((p: ParentModel) => p.left)
    updateChild<
      ParentModel,
      ParentMsg,
      CounterModel,
      CounterInternal,
      CounterExternal
    >({
      get,
      set: (p, l) => ({ ...p, left: l }),
      translator: leftTranslator,
      update: Counter.update,
    })
    expect(get).not.toHaveBeenCalled()
  })
})
