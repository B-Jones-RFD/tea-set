// Elm's Cmd: constructors for the closed `Cmd` union. Pure: a Cmd is data.
// Nothing here performs anything; the runtime interprets commands.

import type { Cmd as CmdType, Dispatch } from './types.js'

/** The `Cmd` type, re-exported so `Cmd` names both the type and the namespace. */
export type Cmd<Msg> = CmdType<Msg>

const none: CmdType<never> = { kind: 'None' }

/**
 * Constructors for commands — descriptions of work for the runtime to perform
 * after an `update`. Building a command runs nothing.
 *
 * Effects that go through a `Task` are turned into commands with
 * `Task.perform` / `Task.attempt`; this namespace covers the rest.
 *
 * @example
 * update: (msg, model) => {
 *   switch (msg.kind) {
 *     case 'Saved':
 *       return [model, Cmd.none]
 *     case 'Submitted':
 *       return [model, Cmd.batch(saveDraft(model), Task.attempt(toMsg, upload(model)))]
 *   }
 * }
 */
export const Cmd = {
  /** The command that does nothing. Return it from `update` when there is no work to do. */
  none,

  /**
   * Combine several commands into one; the runtime performs them in order.
   *
   * The result is canonical: nested batches are flattened and `Cmd.none`s
   * dropped, so an empty or all-`none` batch is `Cmd.none` and a single
   * survivor is returned as itself.
   */
  batch<Msg>(...cmds: ReadonlyArray<CmdType<Msg>>): CmdType<Msg> {
    const flat: CmdType<Msg>[] = []
    const push = (cmd: CmdType<Msg>): void => {
      if (cmd.kind === 'None') return
      if (cmd.kind === 'Batch') cmd.cmds.forEach(push)
      else flat.push(cmd)
    }
    cmds.forEach(push)
    if (flat.length === 0) return none
    if (flat.length === 1) return flat[0] as CmdType<Msg>
    return { kind: 'Batch', cmds: flat }
  },

  /**
   * Relabel the messages a command will produce — Elm's `Cmd.map`. Used to lift
   * a child module's `Cmd<ChildMsg>` into the parent's `Cmd<ParentMsg>`; see
   * also `delegate` and `updateChild`, which do this for you.
   *
   * The mapping is kept as data and composed by the runtime when the command
   * is performed.
   */
  map<A, B>(f: (a: A) => B, cmd: CmdType<A>): CmdType<B> {
    return cmd.kind === 'None' ? none : { kind: 'Map', cmd, f }
  },

  /**
   * Escape hatch: an arbitrary side effect. The runtime calls `run`
   * synchronously with the program's `dispatch`, so the effect may send zero
   * or more messages back. Prefer a `Task` for asynchronous work — it gets
   * cancellation and error handling for free.
   *
   * @example
   * const focus = (id: string): Cmd<never> =>
   *   Cmd.effect(() => document.getElementById(id)?.focus())
   */
  effect<Msg>(run: (dispatch: Dispatch<Msg>) => void): CmdType<Msg> {
    return { kind: 'Effect', run }
  },
}
