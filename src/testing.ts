// Helpers for testing programs: inspect a Cmd as data, or run the interpreter
// against one and collect what it dispatches.

import type { Cmd, CmdLeaf, Dispatch, ErrorStep } from './types.js'
import { performCmd } from './runtime.js'

export { flattenSubs } from './sub.js'

/**
 * Flatten a `Cmd` tree to its working leaves (`Perform`, `Attempt`, `Effect`),
 * in order, with every enclosing `Cmd.map` composed into each leaf's `toMsg` /
 * `run`. `Cmd.none`s vanish and batches are spliced. Nothing is performed, so
 * `update` can be asserted on without running any effect.
 *
 * @example
 * const [, cmd] = update({ kind: 'QueryChanged', query: 'ada' }, model)
 * expect(flattenCmd(cmd)).toHaveLength(1)
 * expect(flattenCmd(cmd)[0].kind).toBe('Attempt')
 */
export function flattenCmd<Msg>(cmd: Cmd<Msg>): CmdLeaf<Msg>[] {
  const leaves: CmdLeaf<Msg>[] = []
  const walk = <A>(c: Cmd<A>, f: (a: A) => Msg): void => {
    switch (c.kind) {
      case 'None':
        return
      case 'Batch':
        for (const inner of c.cmds) walk(inner, f)
        return
      case 'Map':
        walk(c.cmd, (a) => f(c.f(a)))
        return
      case 'Effect':
        leaves.push({
          kind: 'Effect',
          run: (dispatch) => c.run((a) => dispatch(f(a))),
        })
        return
      case 'Perform':
        leaves.push({
          kind: 'Perform',
          task: c.task,
          toMsg: (a) => f(c.toMsg(a)),
        })
        return
      case 'Attempt':
        leaves.push({
          kind: 'Attempt',
          task: c.task,
          toMsg: (r) => f(c.toMsg(r)),
        })
        return
    }
  }
  walk(cmd, (m) => m)
  return leaves
}

/** Options for `runCmd`. */
export type RunCmdOptions<Msg> = {
  /** Also receive each message as it is dispatched, before `runCmd` resolves. */
  readonly dispatch?: Dispatch<Msg>
  /** Passed to the command's tasks; abort it to cancel them. Defaults to a signal that is never aborted. */
  readonly signal?: AbortSignal
}

/**
 * The error `runCmd` rejects with when an effect, task or `toMsg` failed.
 * `step` says which stage failed (see `ErrorStep`) and `cause` holds the
 * original error.
 */
export class CmdError extends Error {
  /** The stage that failed: `'effect'`, `'perform'` or `'attempt'`. */
  readonly step: ErrorStep
  constructor(step: ErrorStep, cause: unknown) {
    super(
      `Cmd failed at step '${step}': ${cause instanceof Error ? cause.message : String(cause)}`,
      {
        cause,
      }
    )
    this.name = 'CmdError'
    this.step = step
  }
}

/**
 * Perform a `Cmd` with the real interpreter and resolve with every message it
 * dispatched, in order, once all its tasks have settled. Rejects with a
 * `CmdError` if an effect, task or `toMsg` failed (the first failure wins).
 *
 * @example
 * const [, cmd] = update({ kind: 'QueryChanged', query: 'ada' }, model)
 * const msgs = await runCmd(cmd)
 * expect(msgs).toEqual([{ kind: 'Received', result: Ok(users) }])
 */
export async function runCmd<Msg>(
  cmd: Cmd<Msg>,
  options: RunCmdOptions<Msg> = {}
): Promise<Msg[]> {
  const messages: Msg[] = []
  const errors: CmdError[] = []
  const dispatch: Dispatch<Msg> = (msg) => {
    messages.push(msg)
    options.dispatch?.(msg)
  }
  const signal = options.signal ?? new AbortController().signal
  await performCmd(cmd, dispatch, signal, (step, error) =>
    errors.push(new CmdError(step, error))
  )
  if (errors.length > 0) throw errors[0]
  return messages
}
