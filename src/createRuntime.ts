import type { Runtime, Program, Unsubscribe } from './types.js'

/**
 * Creates a runtime for executing an Elm Architecture program.
 *
 * The runtime manages the lifecycle of the program, including initialization,
 * message dispatch, model updates, effect execution, subscriptions, and
 * shutdown.
 *
 * Messages dispatched to the runtime are processed sequentially. Each message
 * is passed to the program's `update` function along with the current model.
 * The resulting model becomes the new application state, and any returned
 * effects are passed to the program's effect handler.
 *
 * Effects may execute asynchronously and concurrently. Effects communicate
 * results back to the application by dispatching new messages. Dispatched
 * messages are queued and processed sequentially, ensuring that `update` is
 * never executed concurrently or re-entered.
 *
 * After initialization and each model update, the runtime evaluates the
 * program's subscriptions. Subscriptions that are no longer required are
 * stopped, changed subscriptions are restarted, and new subscriptions are
 * started.
 *
 * Calling {@link Runtime.stop} stops active subscriptions, clears queued
 * messages, and aborts the `AbortSignal` provided to effect handlers.
 *
 * @typeParam Model - The application's state model.
 * @typeParam Msg - The messages that can be dispatched to the application.
 * @typeParam Effect - The effects that can be produced by the application.
 * @typeParam Subscription - The subscriptions that can be derived from the
 * application model.
 * @typeParam Flags - Optional values supplied when the runtime is started.
 *
 * @param program - The Elm Architecture program to execute.
 *
 * @returns A {@link Runtime} that can be started, stopped, observed, and used
 * to dispatch messages to the program.
 *
 * @throws {Error} If the runtime is started while it is already running.
 * @throws {Error} If a message is dispatched while the runtime is not running.
 * @throws {Error} If multiple desired subscriptions have the same subscription
 * key.
 *
 * @example
 * ```ts
 * const runtime = createRuntime({
 *   init() {
 *     return {
 *       model: { count: 0 },
 *       effects: [],
 *     };
 *   },
 *
 *   update(model, message) {
 *     switch (message.type) {
 *       case "increment":
 *         return {
 *           model: {
 *             ...model,
 *             count: model.count + 1,
 *           },
 *           effects: [],
 *         };
 *     }
 *   },
 *
 *   runEffect() {},
 * });
 *
 * runtime.start();
 *
 * runtime.dispatch({
 *   type: "increment",
 * });
 *
 * console.log(runtime.model);
 * // { count: 1 }
 *
 * runtime.stop();
 * ```
 */
export function createRuntime<
  Model,
  Msg,
  Effect,
  Subscription = never,
  Flags = void,
>(
  program: Program<Model, Msg, Effect, Subscription, Flags>
): Runtime<Model, Msg, Flags> {
  let model: Model | undefined
  let running = false
  let processing = false

  const messages: Msg[] = []
  const listeners = new Set<(model: Model) => void>()
  const activeSubscriptions = new Map<
    string,
    {
      subscription: Subscription
      unsubscribe: Unsubscribe
    }
  >()

  let abortController: AbortController | undefined

  // --------------------------------------------------
  // Model notification
  // --------------------------------------------------

  function notify(): void {
    if (model === undefined) {
      return
    }

    for (const listener of listeners) {
      listener(model)
    }
  }

  // --------------------------------------------------
  // Effects
  // --------------------------------------------------

  function runEffect(effect: Effect): void {
    const controller = abortController

    if (!running || controller === undefined) {
      return
    }

    Promise.resolve(
      program.runEffect(effect, dispatch, controller.signal)
    ).catch((error) => {
      /*
       * An EffectHandler should normally convert expected
       * failures into Msg values.
       *
       * Reaching here therefore indicates an unhandled
       * interpreter/runtime failure.
       */
      console.error('Unhandled Elm runtime effect error:', error)
    })
  }

  function runEffects(effects: readonly Effect[]): void {
    for (const effect of effects) {
      runEffect(effect)
    }
  }

  // --------------------------------------------------
  // Subscriptions
  // --------------------------------------------------

  function stopSubscription(key: string): void {
    const active = activeSubscriptions.get(key)

    if (active === undefined) {
      return
    }

    active.unsubscribe()
    activeSubscriptions.delete(key)
  }

  function stopSubscriptions(): void {
    for (const active of activeSubscriptions.values()) {
      active.unsubscribe()
    }

    activeSubscriptions.clear()
  }

  function refreshSubscriptions(): void {
    if (
      model === undefined ||
      program.subscriptions === undefined ||
      program.runSubscription === undefined ||
      program.subscriptionStrategy === undefined
    ) {
      return
    }

    const desired = program.subscriptions(model)
    const strategy = program.subscriptionStrategy
    const desiredByKey = new Map<string, Subscription>()

    for (const subscription of desired) {
      const key = strategy.key(subscription)

      if (desiredByKey.has(key)) {
        throw new Error(`Duplicate subscription key: ${key}`)
      }

      desiredByKey.set(key, subscription)
    }

    /*
     * First remove subscriptions which:
     *
     * 1. no longer exist
     * 2. have changed configuration
     */

    for (const [key, active] of activeSubscriptions) {
      const next = desiredByKey.get(key)

      if (next === undefined || !strategy.equals(active.subscription, next)) {
        stopSubscription(key)
      }
    }

    /*
     * Then start subscriptions which aren't active.
     */

    for (const [key, subscription] of desiredByKey) {
      if (activeSubscriptions.has(key)) {
        continue
      }

      const unsubscribe = program.runSubscription(subscription, dispatch)

      activeSubscriptions.set(key, {
        subscription,
        unsubscribe,
      })
    }
  }

  // --------------------------------------------------
  // Message processing
  // --------------------------------------------------

  function process(message: Msg): void {
    if (model === undefined) {
      throw new Error('Runtime has not been started.')
    }

    const result = program.update(model, message)

    model = result.model

    /*
     * Update observers before starting effects. This
     * means consumers always see the new model before
     * an effect can produce another Msg.
     */

    notify()

    /*
     * Subscription requirements are a function of the
     * new model, just like Elm.
     */

    refreshSubscriptions()

    /*
     * Effects run after the state transition is complete.
     */

    runEffects(result.effects)
  }

  function drain(): void {
    if (processing || !running) {
      return
    }

    processing = true

    try {
      while (running && messages.length > 0) {
        const message = messages.shift()

        if (message !== undefined) {
          process(message)
        }
      }
    } finally {
      processing = false
    }
  }

  function dispatch(message: Msg): void {
    if (!running) {
      throw new Error('Cannot dispatch to a stopped runtime.')
    }

    messages.push(message)

    drain()
  }

  // --------------------------------------------------
  // Public API
  // --------------------------------------------------

  function start(...args: Flags extends void ? [] : [flags: Flags]): void {
    if (running) {
      throw new Error('Runtime has already been started.')
    }

    abortController = new AbortController()

    running = true

    const result = program.init(...args)

    model = result.model

    notify()
    refreshSubscriptions()
    runEffects(result.effects)
  }

  function subscribe(listener: (model: Model) => void): Unsubscribe {
    listeners.add(listener)

    /*
     * Immediately give a newly registered observer the
     * current state if the application has started.
     */

    if (model !== undefined) {
      listener(model)
    }

    return () => {
      listeners.delete(listener)
    }
  }

  function stop(): void {
    if (!running) {
      return
    }

    running = false

    abortController?.abort()
    abortController = undefined

    stopSubscriptions()

    messages.length = 0
  }

  return {
    get model() {
      return model
    },

    get running() {
      return running
    },

    start,
    dispatch,
    subscribe,
    stop,
  }
}
