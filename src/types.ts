// Every public type of tea-set lives here. Naming follows Elm; `kind` is the
// discriminant used by every tagged union. This file contains types only.

// ---------------------------------------------------------------------------
// Runtime plumbing
// ---------------------------------------------------------------------------

/**
 * Sends a message into a running program.
 *
 * The runtime hands a `Dispatch` to `view` and to every subscription source;
 * `element` also returns the program's own `dispatch` so outside code can send
 * messages in (the equivalent of an Elm incoming port).
 */
export type Dispatch<Msg> = (msg: Msg) => void

/**
 * What a subscription source's `start` returns: a function that stops the
 * source and releases anything it holds (timers, listeners, sockets).
 */
export type Teardown = () => void

// ---------------------------------------------------------------------------
// Maybe / Result / RemoteData
// ---------------------------------------------------------------------------

/**
 * An optional value: either `Just` a value or `Nothing`.
 *
 * Build one with the `Just` / `Nothing` constructors and work with it through
 * the `Maybe` namespace (`Maybe.map`, `Maybe.withDefault`, …).
 *
 * @example
 * const first = (xs: number[]): Maybe<number> => (xs.length > 0 ? Just(xs[0]) : Nothing)
 * Maybe.withDefault(0, first([]))  // 0
 */
export type Maybe<A> =
  { readonly kind: 'Just'; readonly value: A } | { readonly kind: 'Nothing' }

/**
 * The outcome of something that can fail: `Ok` with a value of type `A`, or
 * `Err` with an error of type `E`.
 *
 * Build one with the `Ok` / `Err` constructors and work with it through the
 * `Result` namespace (`Result.map`, `Result.andThen`, …).
 *
 * @example
 * const parse = (s: string): Result<string, number> => {
 *   const n = Number(s)
 *   return Number.isNaN(n) ? Err(`not a number: ${s}`) : Ok(n)
 * }
 */
export type Result<E, A> =
  | { readonly kind: 'Ok'; readonly value: A }
  | { readonly kind: 'Err'; readonly error: E }

/**
 * The lifecycle of data fetched from somewhere else: `NotAsked`, `Loading`,
 * `Failure` with an error, or `Success` with the data.
 *
 * Keeping all four states in one value means a view cannot forget one of them.
 * Build one with the `NotAsked` / `Loading` / `Failure` / `Success` constructors
 * and work with it through the `RemoteData` namespace.
 *
 * @example
 * type Model = { user: RemoteData<HttpError, User> }
 * // on request:  { ...model, user: Loading }
 * // on response: { ...model, user: RemoteData.fromResult(msg.result) }
 */
export type RemoteData<E, A> =
  | { readonly kind: 'NotAsked' }
  | { readonly kind: 'Loading' }
  | { readonly kind: 'Failure'; readonly error: E }
  | { readonly kind: 'Success'; readonly value: A }

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

/**
 * A description of asynchronous work that may fail with `E` or succeed with `A`.
 *
 * Building a task runs nothing. Turn it into a `Cmd` with `Task.attempt` (may
 * fail, delivers a `Result`) or `Task.perform` (cannot fail) and return that
 * from `update`; the runtime then calls `run` with the program's `AbortSignal`
 * so in-flight work is cancelled by `stop()`.
 *
 * Implementations never throw or reject: failures arrive as `Err`. Use
 * `Task.fromPromise` to wrap Promise-based code so this holds.
 */
export type Task<E, A> = {
  /** Start the work. Called by the runtime only; user code should not call this. */
  readonly run: (signal: AbortSignal) => Promise<Result<E, A>>
}

// ---------------------------------------------------------------------------
// Cmd
// ---------------------------------------------------------------------------

/**
 * A command: tagged data describing work for the runtime to perform after an
 * `update`. Nothing executes when a `Cmd` is built, which is what keeps
 * `update` pure and directly testable.
 *
 * Create commands with the `Cmd` namespace (`Cmd.none`, `Cmd.batch`, `Cmd.map`,
 * `Cmd.effect`) and with `Task.perform` / `Task.attempt`. The variants are
 * public so tests can inspect a command (see `flattenCmd`), but application
 * code should not need to construct them by hand.
 *
 * `Map`, `Perform` and `Attempt` carry an inner type that is hidden from the
 * outside (an existential). TypeScript spells that with `any`; the constructors
 * keep the public signatures fully typed.
 */
export type Cmd<Msg> =
  | { readonly kind: 'None' }
  | { readonly kind: 'Batch'; readonly cmds: ReadonlyArray<Cmd<Msg>> }
  | {
      readonly kind: 'Map'
      readonly cmd: Cmd<any>
      readonly f: (a: any) => Msg
    }
  | {
      readonly kind: 'Perform'
      readonly task: Task<never, any>
      readonly toMsg: (a: any) => Msg
    }
  | {
      readonly kind: 'Attempt'
      readonly task: Task<any, any>
      readonly toMsg: (r: Result<any, any>) => Msg
    }
  | { readonly kind: 'Effect'; readonly run: (dispatch: Dispatch<Msg>) => void }

/**
 * The variants of `Cmd` that actually do work: `Perform`, `Attempt` and
 * `Effect`. `flattenCmd` returns a command's leaves for inspection in tests.
 */
export type CmdLeaf<Msg> = Extract<
  Cmd<Msg>,
  { kind: 'Perform' | 'Attempt' | 'Effect' }
>

// ---------------------------------------------------------------------------
// Sub
// ---------------------------------------------------------------------------

/**
 * A subscription: a value describing an event source the program wants to
 * listen to (a timer, a WebSocket, keyboard events, …).
 *
 * `subscriptions(model)` returns the full set the program wants right now.
 * After every `update` the runtime compares that set with what is running:
 * new sources are started, missing ones are torn down, and a source whose
 * `params` changed is restarted. Nothing is started by building a `Sub`.
 *
 * Create subscriptions with the `Sub` namespace: `Sub.fromSource` for a source,
 * `Sub.none` / `Sub.batch` to combine, `Sub.map` to relabel a child's.
 */
export type Sub<Msg> =
  | { readonly kind: 'None' }
  | { readonly kind: 'Batch'; readonly subs: ReadonlyArray<Sub<Msg>> }
  | SubSource<Msg>

/**
 * A single event source: the leaf variant of `Sub`.
 *
 * `key` is the source's identity and `params` its configuration; the runtime
 * treats two sources with the same key and structurally equal params as the
 * same running source. `flattenSubs` returns a subscription's leaves.
 */
export type SubSource<Msg> = {
  readonly kind: 'Source'
  /** Identity of the source, e.g. `'time/every'`. Namespaced by `Sub.map`. */
  readonly key: string
  /** Configuration compared structurally to decide whether to restart the source. */
  readonly params: unknown
  /** Starts the source; called by the runtime with `params` and the program's dispatch. */
  readonly start: (params: any, dispatch: Dispatch<Msg>) => Teardown
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

/**
 * The four functions that make up an Elm-architecture program; the equivalent
 * of the record passed to Elm's `Browser.element`. Pass one to `element` to
 * run it.
 *
 * `view` is a plain callback, so tea-set has no framework dependency: render
 * with the DOM, a virtual DOM library, a terminal, or nothing at all.
 *
 * @example
 * const program: Program<void, Model, Msg> = {
 *   init: () => [{ count: 0 }, Cmd.none],
 *   update: (msg, model) => {
 *     switch (msg.kind) {
 *       case 'Incremented': return [{ count: model.count + 1 }, Cmd.none]
 *       default: return assertNever(msg)
 *     }
 *   },
 *   subscriptions: () => Sub.none,
 *   view: (model, dispatch) => render(model, dispatch), // any renderer; call dispatch on events
 * }
 */
export type Program<Flags, Model, Msg> = {
  /** Produce the initial model (and a command to run at start-up) from the flags passed to `element`. */
  readonly init: (flags: Flags) => [Model, Cmd<Msg>]
  /** Produce the next model and a command in response to a message. Must be pure. */
  readonly update: (msg: Msg, model: Model) => [Model, Cmd<Msg>]
  /** Declare the event sources wanted for this model; the runtime reconciles them after every update. */
  readonly subscriptions: (model: Model) => Sub<Msg>
  /** Render the model. Called after `init` and after every `update`; use `dispatch` in event handlers. */
  readonly view: (model: Model, dispatch: Dispatch<Msg>) => void
}

// ---------------------------------------------------------------------------
// Module composition — the translator pattern
// ---------------------------------------------------------------------------

/**
 * The message type of a reusable child module, split in two: `Internal`
 * messages the child handles in its own `update`, and `External` events it
 * raises for whichever parent embeds it (via `raise`).
 *
 * The child never learns the parent's `Msg` type; the parent maps both halves
 * onto its own messages with a `Translator`.
 *
 * @example
 * type InternalMsg = { kind: 'QueryChanged'; query: string }
 * type ExternalMsg = { kind: 'UserChosen'; user: User }
 * export type Msg = ChildMsg<InternalMsg, ExternalMsg>
 */
export type ChildMsg<I, X> =
  | { readonly kind: 'Internal'; readonly msg: I }
  | { readonly kind: 'External'; readonly msg: X }

/**
 * How a parent maps a child's messages onto its own `Msg` type `P`. Pass it to
 * `translate` (for `Cmd.map`, `Sub.map` and views) or `updateChild`.
 *
 * @example
 * const searchTranslator: Translator<SearchBox.InternalMsg, SearchBox.ExternalMsg, Msg> = {
 *   onInternal: (msg) => ({ kind: 'SearchMsg', msg: Internal(msg) }),
 *   onExternal: (event) => ({ kind: 'UrlChanged', path: `/users/${event.user.id}` }),
 * }
 */
export type Translator<I, X, P> = {
  /** Wrap an internal child message so it is routed back to the child's `update`. */
  readonly onInternal: (msg: I) => P
  /** Turn an event the child raised into whatever the parent wants to do about it. */
  readonly onExternal: (msg: X) => P
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

/**
 * Which stage of the loop raised an error, as reported to the `onError` hook.
 *
 * - `'update'`, `'view'`, `'subscriptions'`: the program function of that name threw.
 * - `'sub-start'`, `'sub-teardown'`: a subscription source's `start` or its teardown threw.
 * - `'effect'`: a `Cmd.effect` function threw.
 * - `'perform'`: a task passed to `Task.perform` produced an `Err` anyway, or its `toMsg` threw.
 * - `'attempt'`: the `toMsg` of a `Task.attempt` threw (a failing task is not an error here — it arrives as an `Err` message).
 *
 * `init` is not a step: a program with no initial model cannot run, so a
 * throwing `init` always propagates out of `element`.
 */
export type ErrorStep =
  | 'update'
  | 'view'
  | 'subscriptions'
  | 'sub-start'
  | 'sub-teardown'
  | 'effect'
  | 'perform'
  | 'attempt'

/** What the runtime knows about where an error happened. */
export type ErrorContext<Msg> = {
  /** The stage that failed. */
  readonly step: ErrorStep
  /** The message being processed when the error occurred, if any (absent during start-up and `stop()`). */
  readonly msg?: Msg
}

/** Arguments to `element`. */
export type ElementOptions<Flags, Model, Msg> = {
  /** The program to run. */
  readonly program: Program<Flags, Model, Msg>
  /** Passed to `program.init`. Omit when `Flags` is `void`. */
  readonly flags?: Flags
  /**
   * Called instead of rethrowing when a step fails; the model is left as it was
   * before that step and the program keeps running. Without it, synchronous
   * failures throw out of `dispatch` (or out of `element` during start-up) and
   * asynchronous ones surface as unhandled rejections.
   */
  readonly onError?: (error: unknown, context: ErrorContext<Msg>) => void
}

/** A started program, as returned by `element`. */
export type Running<Msg> = {
  /**
   * Send a message into the program from outside (an "incoming port").
   * Messages sent while an update is in progress are queued and processed in
   * order. Ignored after `stop()`.
   */
  readonly dispatch: Dispatch<Msg>
  /**
   * Shut the program down: tears down every subscription, aborts the
   * `AbortSignal` handed to tasks (results arriving afterwards are discarded),
   * and makes further `dispatch` calls no-ops. Safe to call more than once.
   */
  readonly stop: () => void
}
