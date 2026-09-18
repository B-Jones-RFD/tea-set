// Elm's Task: Promise-based, cancellable through an AbortSignal. Pure:
// building a Task never runs anything; only the runtime calls `run`.

import type { Cmd, Result as ResultType, Task as TaskType } from './types.js'
import { Ok, Err } from './result.js'

/** The `Task` type, re-exported so `Task` names both the type and the namespace. */
export type Task<E, A> = TaskType<E, A>

const task = <E, A>(run: TaskType<E, A>['run']): TaskType<E, A> => ({ run })

/** The reason a task receives when it is cancelled before it starts. */
const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException('The task was aborted', 'AbortError')

/**
 * Build, combine and run asynchronous work as `Task` values.
 *
 * A task describes work; nothing happens until it is turned into a `Cmd` with
 * `Task.attempt` or `Task.perform` and returned from `update`. The runtime then
 * runs it with the program's `AbortSignal`, so `stop()` cancels it. Every
 * combinator takes the task as its last argument, as in Elm.
 *
 * @example
 * const fetchUser = (id: string): Task<HttpError, User> =>
 *   Task.fromPromise(
 *     async (signal) => {
 *       const res = await fetch(`/api/users/${id}`, { signal })
 *       if (!res.ok) throw new Error(`HTTP ${res.status}`)
 *       return (await res.json()) as User
 *     },
 *     (e) => ({ kind: 'Network', reason: String(e) })
 *   )
 *
 * // in update:
 * return [{ ...model, user: Loading }, Task.attempt((result) => ({ kind: 'UserReceived', result }), fetchUser(id))]
 */
export const Task = {
  /** A task that immediately succeeds with `value`. */
  succeed<A>(value: A): TaskType<never, A> {
    return task(async () => Ok(value))
  },

  /** A task that immediately fails with `error`. */
  fail<E>(error: E): TaskType<E, never> {
    return task(async () => Err(error))
  },

  /**
   * Wrap Promise-returning work. `fn` receives the program's `AbortSignal`
   * (pass it to `fetch`, timers, …) so cancellation reaches the work. A
   * rejection or throw is mapped to `E` by `onError`; if the signal is already
   * aborted, `fn` is not called at all and the task fails with
   * `onError(signal.reason)`.
   */
  fromPromise<E, A>(
    fn: (signal: AbortSignal) => Promise<A>,
    onError: (error: unknown) => E
  ): TaskType<E, A> {
    return task(async (signal) => {
      if (signal.aborted) return Err(onError(abortReason(signal)))
      try {
        return Ok(await fn(signal))
      } catch (error) {
        return Err(onError(error))
      }
    })
  },

  /** Transform the success value of a task. */
  map<E, A, B>(f: (a: A) => B, t: TaskType<E, A>): TaskType<E, B> {
    return task(async (signal) => {
      const result = await t.run(signal)
      return result.kind === 'Ok' ? Ok(f(result.value)) : result
    })
  },

  /** Transform the error of a task — e.g. to unify error types before `Task.andThen`. */
  mapError<E, F, A>(f: (e: E) => F, t: TaskType<E, A>): TaskType<F, A> {
    return task(async (signal) => {
      const result = await t.run(signal)
      return result.kind === 'Err' ? Err(f(result.error)) : result
    })
  },

  /** Run `t`, then the task produced from its value. An `Err` short-circuits. */
  andThen<E, A, B>(
    f: (a: A) => TaskType<E, B>,
    t: TaskType<E, A>
  ): TaskType<E, B> {
    return task(async (signal) => {
      const result = await t.run(signal)
      return result.kind === 'Ok' ? f(result.value).run(signal) : result
    })
  },

  /** Run two tasks in order and combine their values with `f`. */
  map2<E, A, B, C>(
    f: (a: A, b: B) => C,
    ta: TaskType<E, A>,
    tb: TaskType<E, B>
  ): TaskType<E, C> {
    return Task.andThen((a) => Task.map((b) => f(a, b), tb), ta)
  },

  /** Run tasks one after another, collecting their values; the first `Err` wins. */
  sequence<E, A>(tasks: ReadonlyArray<TaskType<E, A>>): TaskType<E, A[]> {
    return task(async (signal) => {
      const values: A[] = []
      for (const t of tasks) {
        const result = await t.run(signal)
        if (result.kind === 'Err') return result
        values.push(result.value)
      }
      return Ok(values)
    })
  },

  /**
   * Turn a task that cannot fail into a command delivering its value as a
   * `Msg`. Should the task produce an `Err` anyway, the runtime reports it to
   * `onError` with step `'perform'`.
   *
   * @example
   * Task.perform((now) => ({ kind: 'GotTime', now }), Task.succeed(Date.now()))
   */
  perform<A, Msg>(toMsg: (a: A) => Msg, t: TaskType<never, A>): Cmd<Msg> {
    return { kind: 'Perform', task: t, toMsg }
  },

  /**
   * Turn a task that may fail into a command delivering its `Result` as a
   * `Msg`, so `update` handles success and failure in one branch.
   *
   * @example
   * Task.attempt((result) => ({ kind: 'UserReceived', result }), fetchUser(id))
   */
  attempt<E, A, Msg>(
    toMsg: (r: ResultType<E, A>) => Msg,
    t: TaskType<E, A>
  ): Cmd<Msg> {
    return { kind: 'Attempt', task: t, toMsg }
  },
}
