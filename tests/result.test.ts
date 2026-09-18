import { describe, it, expect } from 'vitest'
import { Ok, Err, Result, assertNever } from '../src/result.js'
import { Just, Nothing } from '../src/maybe.js'
import type { Maybe, Result as ResultType } from '../src/types.js'

const inc = (n: number) => n + 1
const dbl = (n: number) => n * 2

describe('Result', () => {
  it('constructs tagged data', () => {
    expect(Ok(1)).toEqual({ kind: 'Ok', value: 1 })
    expect(Err('e')).toEqual({ kind: 'Err', error: 'e' })
  })

  it('map obeys identity and composition and passes Err through', () => {
    const r: ResultType<string, number> = Ok(3)
    expect(Result.map((x) => x, r)).toEqual(r)
    expect(Result.map(dbl, Result.map(inc, r))).toEqual(
      Result.map((x) => dbl(inc(x)), r)
    )
    expect(Result.map(inc, Err('e'))).toEqual(Err('e'))
  })

  it('mapError touches only Err', () => {
    expect(Result.mapError((e: string) => e.length, Err('abc'))).toEqual(Err(3))
    expect(Result.mapError((e: string) => e.length, Ok(1))).toEqual(Ok(1))
  })

  it('andThen chains and short-circuits on Err', () => {
    const parse = (s: string): ResultType<string, number> =>
      /^\d+$/.test(s) ? Ok(Number(s)) : Err(`not a number: ${s}`)
    const positive = (n: number): ResultType<string, number> =>
      n > 0 ? Ok(n) : Err('not positive')
    expect(Result.andThen(positive, parse('42'))).toEqual(Ok(42))
    expect(Result.andThen(positive, parse('0'))).toEqual(Err('not positive'))
    expect(Result.andThen(positive, parse('x'))).toEqual(Err('not a number: x'))
  })

  it('withDefault', () => {
    expect(Result.withDefault(0, Ok(5))).toBe(5)
    expect(Result.withDefault(0, Err('e'))).toBe(0)
  })

  it('toMaybe / fromMaybe', () => {
    expect(Result.toMaybe(Ok(1))).toEqual(Just(1))
    expect(Result.toMaybe(Err('e'))).toEqual(Nothing)
    expect(Result.fromMaybe('missing', Just(1))).toEqual(Ok(1))
    expect(Result.fromMaybe('missing', Nothing as Maybe<number>)).toEqual(
      Err('missing')
    )
  })

  it('isOk / isErr narrow', () => {
    const r: ResultType<string, number> = Err('e')
    expect(Result.isOk(r)).toBe(false)
    expect(Result.isErr(r)).toBe(true)
    if (Result.isErr(r)) expect(r.error).toBe('e')
  })
})

describe('assertNever', () => {
  it('throws with the offending value when reached at runtime', () => {
    expect(() => assertNever({ kind: 'Bogus' } as never)).toThrow(
      'Unhandled variant'
    )
  })

  it('makes a non-exhaustive switch a compile error', () => {
    const describe = (r: ResultType<string, number>): string => {
      switch (r.kind) {
        case 'Ok':
          return 'ok'
        default:
          // @ts-expect-error — the 'Err' branch is missing, so `r` is not `never`
          return assertNever(r)
      }
    }
    expect(describe(Ok(1))).toBe('ok')
  })
})
