// Elm's Sub: values describing event sources. Pure: building a Sub never
// starts anything; the runtime starts, reconciles and tears down sources.

import type { Dispatch, Sub as SubType, SubSource, Teardown } from './types.js'

/** The `Sub` type, re-exported so `Sub` names both the type and the namespace. */
export type Sub<Msg> = SubType<Msg>

const none: SubType<never> = { kind: 'None' }

/**
 * Constructors for subscriptions — declarations of the event sources a program
 * wants to listen to. Return them from `subscriptions(model)`; the runtime
 * starts, restarts and stops the underlying sources as that value changes.
 *
 * @example
 * const everyMs = <Msg>(ms: number, toMsg: () => Msg): Sub<Msg> =>
 *   Sub.fromSource('time/every', { ms }, ({ ms }, dispatch) => {
 *     const id = setInterval(() => dispatch(toMsg()), ms)
 *     return () => clearInterval(id)
 *   })
 *
 * subscriptions: (model) => (model.ticking ? everyMs(1000, () => ({ kind: 'Ticked' })) : Sub.none)
 */
export const Sub = {
  /** No subscriptions. */
  none,

  /**
   * Combine several subscriptions into one. Canonical like `Cmd.batch`:
   * nested batches are flattened and `Sub.none`s dropped.
   */
  batch<Msg>(...subs: ReadonlyArray<SubType<Msg>>): SubType<Msg> {
    const flat: SubType<Msg>[] = []
    const push = (sub: SubType<Msg>): void => {
      if (sub.kind === 'None') return
      if (sub.kind === 'Batch') sub.subs.forEach(push)
      else flat.push(sub)
    }
    subs.forEach(push)
    if (flat.length === 0) return none
    if (flat.length === 1) return flat[0] as SubType<Msg>
    return { kind: 'Batch', subs: flat }
  },

  /**
   * Describe an event source.
   *
   * - `key` is the source's identity (e.g. `'time/every'`, `'ws/orders'`). Two
   *   sources with the same key are the same source.
   * - `params` is its configuration. The runtime compares params structurally
   *   after every update (primitives, arrays, plain objects and `Date`s) and
   *   restarts the source when they change. Anything else — class instances,
   *   `Map`s, functions — compares by reference, so encode it in the key instead.
   * - `start` is called by the runtime with the params and the program's
   *   dispatch when the source should begin, and must return a teardown that
   *   stops it.
   *
   * @example
   * const onKeyDown = <Msg>(toMsg: (key: string) => Msg): Sub<Msg> =>
   *   Sub.fromSource('keyboard/keydown', null, (_, dispatch) => {
   *     const handler = (e: KeyboardEvent) => dispatch(toMsg(e.key))
   *     window.addEventListener('keydown', handler)
   *     return () => window.removeEventListener('keydown', handler)
   *   })
   */
  fromSource<Msg, Params>(
    key: string,
    params: Params,
    start: (params: Params, dispatch: Dispatch<Msg>) => Teardown
  ): SubType<Msg> {
    return { kind: 'Source', key, params, start }
  },

  /**
   * Relabel a child module's subscriptions into the parent's message space —
   * Elm's `Sub.map`, plus a `namespace` that is prefixed onto every key
   * (`namespace::key`) so two instances of the same child module do not
   * collapse into one running source.
   *
   * @example
   * subscriptions: (model) => Sub.map('search', toParent, SearchBox.subscriptions(model.search))
   */
  map<A, B>(namespace: string, f: (a: A) => B, sub: SubType<A>): SubType<B> {
    switch (sub.kind) {
      case 'None':
        return none
      case 'Batch':
        return {
          kind: 'Batch',
          subs: sub.subs.map((s) => Sub.map(namespace, f, s)),
        }
      case 'Source':
        return {
          kind: 'Source',
          key: `${namespace}::${sub.key}`,
          params: sub.params,
          start: (params, dispatch) =>
            sub.start(params, (a: A) => dispatch(f(a))),
        }
    }
  },
}

/**
 * Flatten a `Sub` tree to its `Source` leaves, in order. Useful in tests to
 * assert which sources a model subscribes to without starting any of them.
 *
 * @example
 * flattenSubs(subscriptions(model)).map((s) => s.key)  // ['time/every', 'search::keyboard/keydown']
 */
export function flattenSubs<Msg>(sub: SubType<Msg>): SubSource<Msg>[] {
  switch (sub.kind) {
    case 'None':
      return []
    case 'Batch':
      return sub.subs.flatMap(flattenSubs)
    case 'Source':
      return [sub]
  }
}

/**
 * Structural equality for subscription params: primitives, arrays, plain
 * objects and `Date`s. Anything else (class instances, Map, Set, functions)
 * compares by reference.
 *
 * @internal Used by the runtime to decide whether to restart a source.
 */
export function paramsEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null
  )
    return false
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false
    return a.every((item, i) => paramsEqual(item, b[i]))
  }
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false
  if (
    Object.getPrototypeOf(a) !== Object.prototype &&
    Object.getPrototypeOf(a) !== null
  )
    return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  const rb = b as Record<string, unknown>
  return ka.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(rb, k) &&
      paramsEqual((a as Record<string, unknown>)[k], rb[k])
  )
}
