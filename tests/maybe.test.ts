import { describe, it, expect } from 'vitest'
import { Just, Nothing, Maybe } from '../src/maybe.js'
import type { Maybe as MaybeType } from '../src/types.js'

const inc = (n: number) => n + 1
const dbl = (n: number) => n * 2

describe('Maybe', () => {
  it('constructs tagged data', () => {
    expect(Just(1)).toEqual({ kind: 'Just', value: 1 })
    expect(Nothing).toEqual({ kind: 'Nothing' })
  })

  it('map obeys identity and composition', () => {
    const m = Just(3)
    expect(Maybe.map((x) => x, m)).toEqual(m)
    expect(Maybe.map(dbl, Maybe.map(inc, m))).toEqual(
      Maybe.map((x) => dbl(inc(x)), m)
    )
    expect(Maybe.map(inc, Nothing)).toEqual(Nothing)
  })

  it('map2 requires both sides', () => {
    expect(Maybe.map2((a, b) => a + b, Just(1), Just(2))).toEqual(Just(3))
    expect(
      Maybe.map2((a: number, b: number) => a + b, Just(1), Nothing)
    ).toEqual(Nothing)
    expect(
      Maybe.map2((a: number, b: number) => a + b, Nothing, Just(2))
    ).toEqual(Nothing)
  })

  it('andThen chains and short-circuits', () => {
    const half = (n: number) => (n % 2 === 0 ? Just(n / 2) : Nothing)
    expect(Maybe.andThen(half, Just(8))).toEqual(Just(4))
    expect(Maybe.andThen(half, Maybe.andThen(half, Just(8)))).toEqual(Just(2))
    expect(Maybe.andThen(half, Just(3))).toEqual(Nothing)
    expect(Maybe.andThen(half, Nothing)).toEqual(Nothing)
  })

  it('withDefault', () => {
    expect(Maybe.withDefault(0, Just(5))).toBe(5)
    expect(Maybe.withDefault(0, Nothing)).toBe(0)
  })

  it('isJust / isNothing narrow', () => {
    const m: MaybeType<number> = Just(1)
    expect(Maybe.isJust(m)).toBe(true)
    expect(Maybe.isNothing(m)).toBe(false)
    if (Maybe.isJust(m)) expect(m.value).toBe(1)
    expect(Maybe.isNothing(Nothing)).toBe(true)
  })

  it('fromNullable / toNullable round-trip', () => {
    expect(Maybe.fromNullable(null)).toEqual(Nothing)
    expect(Maybe.fromNullable(undefined)).toEqual(Nothing)
    expect(Maybe.fromNullable(0)).toEqual(Just(0))
    expect(Maybe.fromNullable('')).toEqual(Just(''))
    expect(Maybe.toNullable(Just('a'))).toBe('a')
    expect(Maybe.toNullable(Nothing)).toBeNull()
  })
})
