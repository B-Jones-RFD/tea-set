// Parent/child composition with the translator pattern. Pure functions only.
//
// A child module's Msg is `ChildMsg<Internal, External>`: `Internal` messages
// it handles itself, `External` events it raises for its parent. The parent
// supplies a `Translator` that maps both onto its own Msg, and lifts the
// child's Cmds, Subs and view with `translate`, `delegate` / `updateChild`,
// `Cmd.map` and `Sub.map`.

import type { ChildMsg, Cmd as CmdType, Translator } from './types.js'
import { Cmd } from './cmd.js'

/**
 * Wrap a message the child handles itself.
 *
 * @example
 * onInternal: (msg) => ({ kind: 'SearchMsg', msg: Internal(msg) })
 */
export const Internal = <I>(msg: I): ChildMsg<I, never> => ({
  kind: 'Internal',
  msg,
})

/** Wrap an event the child raises for its parent. Usually produced via `raise`. */
export const External = <X>(msg: X): ChildMsg<never, X> => ({
  kind: 'External',
  msg,
})

/**
 * A command that raises an `External` event for the parent. Return it from the
 * child's `update`; it is delivered through the parent's translator like any
 * other child message, so the child still never sees a parent `Msg`.
 *
 * @example
 * case 'Chose':
 *   return [{ ...model, open: false }, raise({ kind: 'UserChosen', user: msg.msg.user })]
 */
export function raise<I, X>(msg: X): CmdType<ChildMsg<I, X>> {
  return Cmd.effect((dispatch) => dispatch(External(msg)))
}

/**
 * Turn a `Translator` into the `ChildMsg → ParentMsg` function used with
 * `Cmd.map`, `Sub.map`, and when wrapping the dispatch handed to a child view.
 *
 * @example
 * const toParent = translate(searchTranslator)
 * // subscriptions: Sub.map('search', toParent, SearchBox.subscriptions(model.search))
 * // view:          SearchBox.view(model.search, (msg) => dispatch(toParent(msg)))
 */
export function translate<I, X, P>(
  translator: Translator<I, X, P>
): (msg: ChildMsg<I, X>) => P {
  return (msg) =>
    msg.kind === 'Internal'
      ? translator.onInternal(msg.msg)
      : translator.onExternal(msg.msg)
}

/**
 * Relabel a child's `[Model, Cmd<ChildMsg>]` into the parent's message space.
 * The model passes through unchanged; the parent lifts it into its own model
 * (typically with a spread) after calling this. `updateChild` packages this
 * up for the common case.
 *
 * @example
 * const [search, cmd] = delegate(toParent, SearchBox.update(msg.msg, model.search))
 * return [{ ...model, search }, cmd]
 */
export function delegate<Model, A, B>(
  f: (a: A) => B,
  [model, cmd]: readonly [Model, CmdType<A>]
): [Model, CmdType<B>] {
  return [model, Cmd.map(f, cmd)]
}

/** Everything `updateChild` needs to run a child's `update` inside a parent's. */
export type UpdateChildOptions<PModel, PMsg, CModel, I, X> = {
  /** Read the child model out of the parent model. */
  readonly get: (parent: PModel) => CModel
  /** Store the updated child model in the parent model. */
  readonly set: (parent: PModel, child: CModel) => PModel
  /** Maps the child's messages and events onto the parent's `Msg`. */
  readonly translator: Translator<I, X, PMsg>
  /** The child module's `update`. */
  readonly update: (
    msg: ChildMsg<I, X>,
    model: CModel
  ) => [CModel, CmdType<ChildMsg<I, X>>]
}

/**
 * Build a parent-shaped update step for one child, so the parent's branch for
 * that child reads as a single call.
 *
 * @example
 * const search = updateChild({
 *   get: (model: Model) => model.search,
 *   set: (model, search) => ({ ...model, search }),
 *   translator: searchTranslator,
 *   update: SearchBox.update,
 * })
 * // in the parent's update:
 * case 'SearchMsg': return search(msg.msg, model)
 */
export function updateChild<PModel, PMsg, CModel, I, X>(
  options: UpdateChildOptions<PModel, PMsg, CModel, I, X>
): (msg: ChildMsg<I, X>, parent: PModel) => [PModel, CmdType<PMsg>] {
  const toParent = translate(options.translator)
  return (msg, parent) => {
    const [child, cmd] = delegate(
      toParent,
      options.update(msg, options.get(parent))
    )
    return [options.set(parent, child), cmd]
  }
}
