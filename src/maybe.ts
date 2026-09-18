// Elm's Maybe: constructors and the `Maybe` namespace. Pure functions only.

import type { Maybe as MaybeType } from './types.js'

/** The `Maybe` type, re-exported so `Maybe` names both the type and the namespace. */
export type Maybe<A> = MaybeType<A>

/** Wrap a present value: `Just(3)` is a `Maybe<number>` holding `3`. */
export const Just = <A>(value: A): MaybeType<A> => ({ kind: 'Just', value })

/** The absent value. Assignable to any `Maybe<A>`. */
export const Nothing: MaybeType<never> = { kind: 'Nothing' }

/**
 * Functions for working with `Maybe` values. Every function takes the `Maybe`
 * as its last argument, as in Elm.
 *
 * @example
 * const port = Maybe.withDefault(3000, Maybe.map(Number, Maybe.fromNullable(process.env.PORT)))
 */
export const Maybe = {
  /** Apply `f` to the value inside a `Just`; `Nothing` passes through. */
  map<A, B>(f: (a: A) => B, maybe: MaybeType<A>): MaybeType<B> {
    return maybe.kind === 'Just' ? Just(f(maybe.value)) : Nothing
  },

  /** Combine two `Maybe`s with `f`; `Nothing` if either is `Nothing`. */
  map2<A, B, C>(
    f: (a: A, b: B) => C,
    ma: MaybeType<A>,
    mb: MaybeType<B>
  ): MaybeType<C> {
    return ma.kind === 'Just' && mb.kind === 'Just'
      ? Just(f(ma.value, mb.value))
      : Nothing
  },

  /** Chain a computation that may itself produce `Nothing`. */
  andThen<A, B>(f: (a: A) => MaybeType<B>, maybe: MaybeType<A>): MaybeType<B> {
    return maybe.kind === 'Just' ? f(maybe.value) : Nothing
  },

  /** Unwrap a `Just`, or return `fallback` for `Nothing`. */
  withDefault<A>(fallback: A, maybe: MaybeType<A>): A {
    return maybe.kind === 'Just' ? maybe.value : fallback
  },

  /** Type guard: narrows to the `Just` variant. */
  isJust<A>(
    maybe: MaybeType<A>
  ): maybe is { readonly kind: 'Just'; readonly value: A } {
    return maybe.kind === 'Just'
  },

  /** Type guard: narrows to the `Nothing` variant. */
  isNothing<A>(maybe: MaybeType<A>): maybe is { readonly kind: 'Nothing' } {
    return maybe.kind === 'Nothing'
  },

  /** Bring a nullable value in: `null` and `undefined` become `Nothing`; anything else is `Just`. */
  fromNullable<A>(value: A | null | undefined): MaybeType<A> {
    return value === null || value === undefined ? Nothing : Just(value)
  },

  /** Hand a value out to nullable-style code: `Just a` becomes `a`; `Nothing` becomes `null`. */
  toNullable<A>(maybe: MaybeType<A>): A | null {
    return maybe.kind === 'Just' ? maybe.value : null
  },
}
