import { describe, it, expect, vi } from 'vitest'
import { Sub, flattenSubs, paramsEqual } from '../src/sub.js'
import type { Dispatch, Sub as SubType } from '../src/types.js'

type Msg = { kind: 'Tick' } | { kind: 'Child'; n: number }

const tick = (ms: number) =>
  Sub.fromSource<number, { ms: number }>('tick', { ms }, () => () => {})

describe('Sub constructors', () => {
  it('none is the None variant', () => {
    expect(Sub.none).toEqual({ kind: 'None' })
  })

  it('fromSource stores key, params and start without calling start', () => {
    const start = vi.fn(() => () => {})
    const sub = Sub.fromSource<Msg, { ms: number }>('tick', { ms: 100 }, start)
    expect(sub).toEqual({
      kind: 'Source',
      key: 'tick',
      params: { ms: 100 },
      start,
    })
    expect(start).not.toHaveBeenCalled()
  })

  it('batch canonicalises like Cmd.batch', () => {
    const a = tick(1)
    const b = tick(2)
    expect(Sub.batch()).toBe(Sub.none)
    expect(Sub.batch(Sub.none, Sub.batch())).toBe(Sub.none)
    expect(Sub.batch(Sub.none, a)).toBe(a)
    expect(Sub.batch(a, Sub.batch(Sub.none, b))).toEqual({
      kind: 'Batch',
      subs: [a, b],
    })
  })
})

describe('Sub.map', () => {
  const wrap = (n: number): Msg => ({ kind: 'Child', n })

  it('namespaces keys and keeps params', () => {
    const mapped = Sub.map('left', wrap, tick(5))
    expect(mapped.kind).toBe('Source')
    if (mapped.kind === 'Source') {
      expect(mapped.key).toBe('left::tick')
      expect(mapped.params).toEqual({ ms: 5 })
    }
  })

  it('two instances of the same child get distinct keys', () => {
    const left = flattenSubs(Sub.map('left', wrap, tick(5)))
    const right = flattenSubs(Sub.map('right', wrap, tick(5)))
    expect(left[0]?.key).not.toBe(right[0]?.key)
  })

  it('nests namespaces through repeated maps', () => {
    const inner = Sub.map('child', (n: number) => n, tick(1))
    const outer = Sub.map('parent', wrap, inner)
    expect(flattenSubs(outer).map((s) => s.key)).toEqual([
      'parent::child::tick',
    ])
  })

  it('maps through batches and none', () => {
    expect(Sub.map('x', wrap, Sub.none)).toBe(Sub.none)
    const mapped = Sub.map('x', wrap, Sub.batch(tick(1), tick(2)))
    expect(flattenSubs(mapped).map((s) => s.key)).toEqual([
      'x::tick',
      'x::tick',
    ])
  })

  it('routes dispatched values through f, and does not start at construction', () => {
    const teardown = vi.fn()
    const start = vi.fn(
      (params: { ms: number }, dispatch: Dispatch<number>) => {
        dispatch(params.ms)
        return teardown
      }
    )
    const mapped = Sub.map('c', wrap, Sub.fromSource('tick', { ms: 7 }, start))
    expect(start).not.toHaveBeenCalled()

    const dispatched: Msg[] = []
    const [leaf] = flattenSubs(mapped)
    const stop = leaf!.start(leaf!.params, (m) => dispatched.push(m))
    expect(start).toHaveBeenCalledWith({ ms: 7 }, expect.any(Function))
    expect(dispatched).toEqual([{ kind: 'Child', n: 7 }])
    stop()
    expect(teardown).toHaveBeenCalledOnce()
  })
})

describe('flattenSubs', () => {
  it('returns leaves in order', () => {
    const a = tick(1)
    const b = tick(2)
    const c = tick(3)
    const tree: SubType<number> = Sub.batch(a, Sub.batch(Sub.none, b), c)
    expect(flattenSubs(tree)).toEqual([a, b, c])
    expect(flattenSubs(Sub.none)).toEqual([])
    expect(flattenSubs(a)).toEqual([a])
  })
})

describe('paramsEqual', () => {
  it('primitives', () => {
    expect(paramsEqual(1, 1)).toBe(true)
    expect(paramsEqual(1, 2)).toBe(false)
    expect(paramsEqual('a', 'a')).toBe(true)
    expect(paramsEqual(null, null)).toBe(true)
    expect(paramsEqual(undefined, undefined)).toBe(true)
    expect(paramsEqual(null, undefined)).toBe(false)
    expect(paramsEqual(NaN, NaN)).toBe(true)
    expect(paramsEqual(0, -0)).toBe(false)
    expect(paramsEqual(1, '1')).toBe(false)
  })

  it('arrays', () => {
    expect(paramsEqual([1, [2, 3]], [1, [2, 3]])).toBe(true)
    expect(paramsEqual([1, 2], [2, 1])).toBe(false)
    expect(paramsEqual([1], [1, 2])).toBe(false)
    expect(paramsEqual([], {})).toBe(false)
  })

  it('plain objects, order-insensitive, own keys only', () => {
    expect(paramsEqual({ a: 1, b: { c: [1] } }, { b: { c: [1] }, a: 1 })).toBe(
      true
    )
    expect(paramsEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(paramsEqual({ a: 1 }, { a: 2 })).toBe(false)
    expect(paramsEqual({}, Object.create(null))).toBe(false)
  })

  it('dates by time value', () => {
    expect(paramsEqual(new Date(1), new Date(1))).toBe(true)
    expect(paramsEqual(new Date(1), new Date(2))).toBe(false)
    expect(paramsEqual(new Date(1), 1)).toBe(false)
  })

  it('class instances, Map, Set and functions compare by reference', () => {
    class Box {
      v: number
      constructor(v: number) {
        this.v = v
      }
    }
    const f = () => {}
    expect(paramsEqual(new Box(1), new Box(1))).toBe(false)
    expect(paramsEqual(new Map([[1, 1]]), new Map([[1, 1]]))).toBe(false)
    expect(paramsEqual(new Set([1]), new Set([1]))).toBe(false)
    expect(paramsEqual(f, f)).toBe(true)
    expect(paramsEqual(f, () => {})).toBe(false)
  })
})
