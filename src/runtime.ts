// The only impure module: the Cmd interpreter and the `element` program runner.

import type {
  Cmd,
  Dispatch,
  ElementOptions,
  ErrorStep,
  Running,
  SubSource,
  Teardown,
} from './types.js'
import { flattenSubs, paramsEqual } from './sub.js'

/**
 * How the interpreter reports a failing step to whoever ran it.
 * @internal Not part of the package's public API.
 */
export type StepError = (step: ErrorStep, error: unknown) => void

/**
 * The Cmd interpreter. Walks the `Cmd` tree, composing `Map` functions on the
 * way down. `Effect`s run synchronously; `Perform` / `Attempt` run their task
 * with `signal` and dispatch when it settles unless the signal was aborted in
 * the meantime. The returned promise resolves once every task has settled —
 * `element` ignores it; the test helper `runCmd` awaits it.
 * @internal Not part of the package's public API; use `element` or `runCmd`.
 */
export function performCmd<Msg>(
  cmd: Cmd<Msg>,
  dispatch: Dispatch<Msg>,
  signal: AbortSignal,
  onError: StepError
): Promise<void> {
  const pending: Promise<void>[] = []

  const walk = <A>(c: Cmd<A>, emit: (a: A) => void): void => {
    switch (c.kind) {
      case 'None':
        return
      case 'Batch':
        for (const inner of c.cmds) walk(inner, emit)
        return
      case 'Map':
        walk(c.cmd, (a) => emit(c.f(a)))
        return
      case 'Effect':
        try {
          c.run(emit)
        } catch (error) {
          onError('effect', error)
        }
        return
      case 'Perform':
        pending.push(
          settle(
            (s) => c.task.run(s),
            signal,
            (result) => {
              if (result.kind === 'Ok') emit(c.toMsg(result.value))
              else onError('perform', result.error)
            }
          ).catch((error) => onError('perform', error))
        )
        return
      case 'Attempt':
        pending.push(
          settle(
            (s) => c.task.run(s),
            signal,
            (result) => emit(c.toMsg(result))
          ).catch((error) => onError('attempt', error))
        )
        return
    }
  }

  walk(cmd, dispatch)
  return Promise.all(pending).then(() => undefined)
}

/** Run a task and hand its result on, unless the signal was aborted meanwhile. */
async function settle<R>(
  run: (signal: AbortSignal) => Promise<R>,
  signal: AbortSignal,
  deliver: (result: R) => void
): Promise<void> {
  if (signal.aborted) return
  const result = await run(signal)
  if (signal.aborted) return
  deliver(result)
}

type RunningSub = { readonly params: unknown; readonly teardown: Teardown }

/**
 * Start a program — the equivalent of Elm's `Browser.element`.
 *
 * Calls `init(flags)`, renders `view`, starts `subscriptions` and performs the
 * initial `Cmd`. From then on every dispatched message drives one turn of the
 * loop: `update` → `view` → reconcile subscriptions → perform the returned
 * `Cmd`. Messages dispatched during a turn (from `view`, an effect or a
 * subscription) are queued and processed in order, never recursively.
 *
 * Errors in any step are passed to `options.onError` if given, otherwise
 * rethrown; the model is left as it was before the failing step. A throwing
 * `init` always propagates from this call.
 *
 * @returns `{ dispatch, stop }` — send messages in from outside, and shut the
 * program down (tearing down subscriptions and aborting in-flight tasks).
 *
 * @example
 * const app = element({ program, onError: (error, { step }) => console.error(step, error) })
 * app.dispatch({ kind: 'Started' })
 * // later:
 * app.stop()
 */
export function element<Flags, Model, Msg>(
  options: ElementOptions<Flags, Model, Msg>
): Running<Msg> {
  const { program, onError } = options
  const controller = new AbortController()
  const running = new Map<string, RunningSub>()
  const queue: Msg[] = []
  let draining = false
  let stopped = false
  let model: Model

  const report =
    (msg: Msg | undefined): StepError =>
    (step, error) => {
      if (onError) onError(error, msg === undefined ? { step } : { step, msg })
      else throw error
    }

  const dispatch: Dispatch<Msg> = (msg) => {
    if (stopped) return
    queue.push(msg)
    if (draining) return // re-entrant dispatch: the loop below will pick it up
    drain()
  }

  function drain(): void {
    draining = true
    try {
      while (queue.length > 0 && !stopped) {
        const msg = queue.shift() as Msg
        step(msg)
      }
    } finally {
      draining = false
    }
  }

  /** One turn of the loop for `msg`. Each stage reports its own failure. */
  function step(msg: Msg): void {
    const fail = report(msg)
    let updated: [Model, Cmd<Msg>]
    try {
      updated = program.update(msg, model)
    } catch (error) {
      fail('update', error)
      return
    }
    const [nextModel, cmd] = updated
    model = nextModel
    render(fail)
    reconcile(fail)
    void performCmd(cmd, dispatch, controller.signal, fail)
  }

  function render(fail: StepError): void {
    try {
      program.view(model, dispatch)
    } catch (error) {
      fail('view', error)
    }
  }

  function reconcile(fail: StepError): void {
    let wanted: SubSource<Msg>[]
    try {
      wanted = flattenSubs(program.subscriptions(model))
    } catch (error) {
      fail('subscriptions', error)
      return
    }
    const byKey = new Map<string, SubSource<Msg>>()
    for (const sub of wanted) if (!byKey.has(sub.key)) byKey.set(sub.key, sub)

    for (const [key, current] of running) {
      const want = byKey.get(key)
      if (want && paramsEqual(want.params, current.params)) continue
      running.delete(key)
      teardown(current, fail)
    }
    for (const [key, sub] of byKey) {
      if (running.has(key)) continue
      try {
        running.set(key, {
          params: sub.params,
          teardown: sub.start(sub.params, dispatch),
        })
      } catch (error) {
        fail('sub-start', error)
      }
    }
  }

  function teardown(sub: RunningSub, fail: StepError): void {
    try {
      sub.teardown()
    } catch (error) {
      fail('sub-teardown', error)
    }
  }

  function stop(): void {
    if (stopped) return
    stopped = true
    controller.abort()
    queue.length = 0
    const fail = report(undefined)
    for (const sub of running.values()) teardown(sub, fail)
    running.clear()
  }

  // Start-up. `init` failures propagate: there is no model to continue with.
  draining = true
  try {
    const [initialModel, initialCmd] = program.init(options.flags as Flags)
    model = initialModel
    const fail = report(undefined)
    render(fail)
    reconcile(fail)
    void performCmd(initialCmd, dispatch, controller.signal, fail)
  } finally {
    draining = false
  }
  drain()

  return { dispatch, stop }
}
