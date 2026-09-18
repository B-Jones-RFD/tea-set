// Elm's Result: constructors, the `Result` namespace, and `assertNever` for
// exhaustive `switch` handling. Pure functions only.

import type { Maybe as MaybeType, Result as ResultType } from './types.js'
import { Just, Nothing } from './maybe.js'

/** The `Result` type, re-exported so `Result` names both the type and the namespace. */
export type Result<E, A> = ResultType<E, A>

/** Wrap a successful value. Assignable to any `Result<E, A>`. */
export const Ok = <A>(value: A): ResultType<never, A> => ({ kind: 'Ok', value })

/** Wrap an error. Assignable to any `Result<E, A>`. */
export const Err = <E>(error: E): ResultType<E, never> => ({
  kind: 'Err',
  error,
})

/**
 * Functions for working with `Result` values. Every function takes the
 * `Result` as its last argument, as in Elm.
 *
 * @example
 * const age = Result.andThen(nonNegative, Result.fromMaybe('missing', Maybe.fromNullable(input.age)))
 */
export const Result = {
  /** Apply `f` to the value inside an `Ok`; an `Err` passes through. */
  map<E, A, B>(f: (a: A) => B, result: ResultType<E, A>): ResultType<E, B> {
    return result.kind === 'Ok' ? Ok(f(result.value)) : result
  },

  /** Apply `f` to the error inside an `Err`; an `Ok` passes through. */
  mapError<E, F, A>(
    f: (e: E) => F,
    result: ResultType<E, A>
  ): ResultType<F, A> {
    return result.kind === 'Err' ? Err(f(result.error)) : result
  },

  /** Chain a computation that may itself fail. The first `Err` short-circuits. */
  andThen<E, A, B>(
    f: (a: A) => ResultType<E, B>,
    result: ResultType<E, A>
  ): ResultType<E, B> {
    return result.kind === 'Ok' ? f(result.value) : result
  },

  /** Unwrap an `Ok`, or return `fallback` for an `Err`. */
  withDefault<E, A>(fallback: A, result: ResultType<E, A>): A {
    return result.kind === 'Ok' ? result.value : fallback
  },

  /** Drop the error: `Ok a` becomes `Just a`; `Err` becomes `Nothing`. */
  toMaybe<E, A>(result: ResultType<E, A>): MaybeType<A> {
    return result.kind === 'Ok' ? Just(result.value) : Nothing
  },

  /** Supply an error for the absent case: `Just a` becomes `Ok a`; `Nothing` becomes `Err error`. */
  fromMaybe<E, A>(error: E, maybe: MaybeType<A>): ResultType<E, A> {
    return maybe.kind === 'Just' ? Ok(maybe.value) : Err(error)
  },

  /** Type guard: narrows to the `Ok` variant. */
  isOk<E, A>(
    result: ResultType<E, A>
  ): result is { readonly kind: 'Ok'; readonly value: A } {
    return result.kind === 'Ok'
  },

  /** Type guard: narrows to the `Err` variant. */
  isErr<E, A>(
    result: ResultType<E, A>
  ): result is { readonly kind: 'Err'; readonly error: E } {
    return result.kind === 'Err'
  },
}

/**
 * Stands in for Elm's exhaustive `case`. Put it in the `default` branch of a
 * `switch` over a tagged union: if every variant is handled the argument has
 * type `never` and this compiles; add a variant to the union without handling
 * it and the call becomes a type error. Throws if somehow reached at runtime.
 *
 * @example
 * switch (msg.kind) {
 *   case 'Incremented': return [{ ...model, count: model.count + 1 }, Cmd.none]
 *   case 'Reset':       return [{ ...model, count: 0 }, Cmd.none]
 *   default:            return assertNever(msg)
 * }
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`)
}
