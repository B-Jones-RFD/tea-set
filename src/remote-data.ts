// RemoteData: constructors and the `RemoteData` namespace. Pure functions only.

import type {
  Maybe as MaybeType,
  RemoteData as RemoteDataType,
  Result as ResultType,
} from './types.js'
import { Just, Nothing } from './maybe.js'

/** The `RemoteData` type, re-exported so `RemoteData` names both the type and the namespace. */
export type RemoteData<E, A> = RemoteDataType<E, A>

/** No request has been made yet. Assignable to any `RemoteData<E, A>`. */
export const NotAsked: RemoteDataType<never, never> = { kind: 'NotAsked' }

/** A request is in flight. Assignable to any `RemoteData<E, A>`. */
export const Loading: RemoteDataType<never, never> = { kind: 'Loading' }

/** The request failed with `error`. */
export const Failure = <E>(error: E): RemoteDataType<E, never> => ({
  kind: 'Failure',
  error,
})

/** The request succeeded with `value`. */
export const Success = <A>(value: A): RemoteDataType<never, A> => ({
  kind: 'Success',
  value,
})

/**
 * Functions for working with `RemoteData` values. Every function takes the
 * `RemoteData` as its last argument, as in Elm.
 *
 * @example
 * case 'UsersReceived':
 *   return [{ ...model, users: RemoteData.fromResult(msg.result) }, Cmd.none]
 */
export const RemoteData = {
  /** Apply `f` to the value inside a `Success`; every other state passes through. */
  map<E, A, B>(
    f: (a: A) => B,
    data: RemoteDataType<E, A>
  ): RemoteDataType<E, B> {
    return data.kind === 'Success' ? Success(f(data.value)) : data
  },

  /** Apply `f` to the error inside a `Failure`; every other state passes through. */
  mapError<E, F, A>(
    f: (e: E) => F,
    data: RemoteDataType<E, A>
  ): RemoteDataType<F, A> {
    return data.kind === 'Failure' ? Failure(f(data.error)) : data
  },

  /** Unwrap a `Success`, or return `fallback` for any other state. */
  withDefault<E, A>(fallback: A, data: RemoteDataType<E, A>): A {
    return data.kind === 'Success' ? data.value : fallback
  },

  /**
   * The usual end of a request: the `Result` delivered by `Task.attempt`
   * becomes `Success` (from `Ok`) or `Failure` (from `Err`).
   */
  fromResult<E, A>(result: ResultType<E, A>): RemoteDataType<E, A> {
    return result.kind === 'Ok' ? Success(result.value) : Failure(result.error)
  },

  /** `Success a` becomes `Just a`; every other state becomes `Nothing`. */
  toMaybe<E, A>(data: RemoteDataType<E, A>): MaybeType<A> {
    return data.kind === 'Success' ? Just(data.value) : Nothing
  },

  /** Type guard: narrows to the `Success` variant. */
  isSuccess<E, A>(
    data: RemoteDataType<E, A>
  ): data is { readonly kind: 'Success'; readonly value: A } {
    return data.kind === 'Success'
  },

  /** Type guard: narrows to the `Loading` variant. */
  isLoading<E, A>(
    data: RemoteDataType<E, A>
  ): data is { readonly kind: 'Loading' } {
    return data.kind === 'Loading'
  },
}
