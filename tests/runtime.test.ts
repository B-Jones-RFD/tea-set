// runtime.test.ts

import { describe, expect, it, vi } from 'vitest'

import {
  createRuntime,
  type Dispatch,
  type EffectHandler,
  type Program,
  type SubscriptionHandler,
  type SubscriptionStrategy,
  type UpdateResult,
} from '../src/index.js'

type Model = Readonly<{
  count: number
}>

type Msg =
  | { type: 'increment' }
  | { type: 'decrement' }
  | { type: 'set'; value: number }
  | { type: 'effectCompleted'; value: number }
  | { type: 'subscriptionEvent'; value: number }

type Effect = { type: 'complete'; value: number } | { type: 'noop' }

type Subscription = Readonly<{
  type: 'test'
  id: string
  value: number
}>

function result(
  model: Model,
  effects: readonly Effect[] = []
): UpdateResult<Model, Effect> {
  return {
    model,
    effects,
  }
}

function createProgram(
  overrides: Partial<Program<Model, Msg, Effect, Subscription>> = {}
): Program<Model, Msg, Effect, Subscription> {
  return {
    init() {
      return result({
        count: 0,
      })
    },

    update(model, message) {
      switch (message.type) {
        case 'increment':
          return result({
            count: model.count + 1,
          })

        case 'decrement':
          return result({
            count: model.count - 1,
          })

        case 'set':
          return result({
            count: message.value,
          })

        case 'effectCompleted':
          return result({
            count: message.value,
          })

        case 'subscriptionEvent':
          return result({
            count: message.value,
          })
      }
    },

    runEffect() {},

    ...overrides,
  }
}

describe('createRuntime', () => {
  describe('start', () => {
    it('starts the runtime', () => {
      const runtime = createRuntime(createProgram())

      expect(runtime.running).toBe(false)
      expect(runtime.model).toBeUndefined()

      runtime.start()

      expect(runtime.running).toBe(true)
      expect(runtime.model).toEqual({
        count: 0,
      })
    })

    it('initializes the model from program.init', () => {
      const program = createProgram({
        init() {
          return result({
            count: 42,
          })
        },
      })

      const runtime = createRuntime(program)

      runtime.start()

      expect(runtime.model).toEqual({
        count: 42,
      })
    })

    it('throws when started more than once', () => {
      const runtime = createRuntime(createProgram())

      runtime.start()

      expect(() => {
        runtime.start()
      }).toThrow('Runtime has already been started.')
    })

    it('runs effects returned from init', async () => {
      const runEffect = vi.fn()

      const program = createProgram({
        init() {
          return result({ count: 0 }, [
            {
              type: 'noop',
            },
          ])
        },

        runEffect,
      })

      const runtime = createRuntime(program)

      runtime.start()

      await vi.waitFor(() => {
        expect(runEffect).toHaveBeenCalledTimes(1)
      })

      expect(runEffect).toHaveBeenCalledWith(
        {
          type: 'noop',
        },
        expect.any(Function),
        expect.any(AbortSignal)
      )
    })
  })

  describe('flags', () => {
    it('passes flags to init', () => {
      type Flags = Readonly<{
        initialCount: number
      }>

      const init = vi.fn((flags: Flags): UpdateResult<Model, Effect> => ({
        model: {
          count: flags.initialCount,
        },
        effects: [],
      }))

      const program: Program<Model, Msg, Effect, never, Flags> = {
        init,
        update(model) {
          return result(model)
        },
        runEffect() {},
      }

      const runtime = createRuntime(program)

      runtime.start({
        initialCount: 100,
      })

      expect(init).toHaveBeenCalledWith({
        initialCount: 100,
      })

      expect(runtime.model).toEqual({
        count: 100,
      })
    })
  })

  describe('dispatch', () => {
    it('updates the model', () => {
      const runtime = createRuntime(createProgram())

      runtime.start()

      runtime.dispatch({
        type: 'increment',
      })

      expect(runtime.model).toEqual({
        count: 1,
      })

      runtime.dispatch({
        type: 'increment',
      })

      expect(runtime.model).toEqual({
        count: 2,
      })
    })

    it('processes messages in dispatch order', () => {
      const updates: Msg[] = []

      const program = createProgram({
        update(model, message) {
          updates.push(message)

          switch (message.type) {
            case 'increment':
              return result({
                count: model.count + 1,
              })

            case 'set':
              return result({
                count: message.value,
              })

            default:
              return result(model)
          }
        },
      })

      const runtime = createRuntime(program)

      runtime.start()

      runtime.dispatch({
        type: 'set',
        value: 10,
      })

      runtime.dispatch({
        type: 'increment',
      })

      expect(updates).toEqual([
        {
          type: 'set',
          value: 10,
        },
        {
          type: 'increment',
        },
      ])

      expect(runtime.model).toEqual({
        count: 11,
      })
    })

    it('throws when dispatching before start', () => {
      const runtime = createRuntime(createProgram())

      expect(() => {
        runtime.dispatch({
          type: 'increment',
        })
      }).toThrow('Cannot dispatch to a stopped runtime.')
    })

    it('throws when dispatching after stop', () => {
      const runtime = createRuntime(createProgram())

      runtime.start()
      runtime.stop()

      expect(() => {
        runtime.dispatch({
          type: 'increment',
        })
      }).toThrow('Cannot dispatch to a stopped runtime.')
    })
  })

  describe('message queue', () => {
    it('does not re-enter update when an effect dispatches synchronously', async () => {
      let updateDepth = 0
      let maxDepth = 0

      const update = vi.fn(
        (model: Model, message: Msg): UpdateResult<Model, Effect> => {
          updateDepth++
          maxDepth = Math.max(maxDepth, updateDepth)

          let next: UpdateResult<Model, Effect>

          switch (message.type) {
            case 'increment':
              next = result(
                {
                  count: model.count + 1,
                },
                [
                  {
                    type: 'complete',
                    value: 99,
                  },
                ]
              )
              break

            case 'effectCompleted':
              next = result({
                count: message.value,
              })
              break

            default:
              next = result(model)
          }

          updateDepth--

          return next
        }
      )

      const runEffect: EffectHandler<Effect, Msg> = (effect, dispatch) => {
        if (effect.type === 'complete') {
          dispatch({
            type: 'effectCompleted',
            value: effect.value,
          })
        }
      }

      const runtime = createRuntime({
        init() {
          return result({
            count: 0,
          })
        },

        update,

        runEffect,
      })

      runtime.start()

      runtime.dispatch({
        type: 'increment',
      })

      await vi.waitFor(() => {
        expect(runtime.model).toEqual({
          count: 99,
        })
      })

      expect(maxDepth).toBe(1)
      expect(update).toHaveBeenCalledTimes(2)
    })
  })

  describe('effects', () => {
    it('runs effects produced by update', async () => {
      const runEffect = vi.fn()

      const runtime = createRuntime(
        createProgram({
          update(model, message) {
            if (message.type === 'increment') {
              return result(
                {
                  count: model.count + 1,
                },
                [
                  {
                    type: 'noop',
                  },
                ]
              )
            }

            return result(model)
          },

          runEffect,
        })
      )

      runtime.start()

      runtime.dispatch({
        type: 'increment',
      })

      await vi.waitFor(() => {
        expect(runEffect).toHaveBeenCalledTimes(1)
      })
    })

    it('allows an effect to dispatch a message', async () => {
      const runEffect: EffectHandler<Effect, Msg> = async (
        effect,
        dispatch
      ) => {
        if (effect.type === 'complete') {
          dispatch({
            type: 'effectCompleted',
            value: effect.value,
          })
        }
      }

      const runtime = createRuntime(
        createProgram({
          update(model, message) {
            switch (message.type) {
              case 'increment':
                return result(
                  {
                    count: model.count + 1,
                  },
                  [
                    {
                      type: 'complete',
                      value: 50,
                    },
                  ]
                )

              case 'effectCompleted':
                return result({
                  count: message.value,
                })

              default:
                return result(model)
            }
          },

          runEffect,
        })
      )

      runtime.start()

      runtime.dispatch({
        type: 'increment',
      })

      await vi.waitFor(() => {
        expect(runtime.model).toEqual({
          count: 50,
        })
      })
    })

    it('runs multiple effects independently', async () => {
      const effects: Effect[] = []

      const runtime = createRuntime(
        createProgram({
          update(model, message) {
            if (message.type === 'increment') {
              return result(model, [
                {
                  type: 'complete',
                  value: 1,
                },
                {
                  type: 'complete',
                  value: 2,
                },
              ])
            }

            return result(model)
          },

          runEffect(effect) {
            effects.push(effect)
          },
        })
      )

      runtime.start()

      runtime.dispatch({
        type: 'increment',
      })

      await vi.waitFor(() => {
        expect(effects).toHaveLength(2)
      })

      expect(effects).toEqual([
        {
          type: 'complete',
          value: 1,
        },
        {
          type: 'complete',
          value: 2,
        },
      ])
    })

    it('passes an AbortSignal to effects', async () => {
      let receivedSignal: AbortSignal | undefined

      const runtime = createRuntime(
        createProgram({
          update(model, message) {
            if (message.type === 'increment') {
              return result(model, [
                {
                  type: 'noop',
                },
              ])
            }

            return result(model)
          },

          runEffect(_effect, _dispatch, signal) {
            receivedSignal = signal
          },
        })
      )

      runtime.start()

      runtime.dispatch({
        type: 'increment',
      })

      await vi.waitFor(() => {
        expect(receivedSignal).toBeDefined()
      })

      expect(receivedSignal?.aborted).toBe(false)

      runtime.stop()

      expect(receivedSignal?.aborted).toBe(true)
    })
  })

  describe('subscribe', () => {
    it('notifies listeners when the model changes', () => {
      const listener = vi.fn()

      const runtime = createRuntime(createProgram())

      runtime.start()

      runtime.subscribe(listener)

      runtime.dispatch({
        type: 'increment',
      })

      expect(listener).toHaveBeenCalledWith({
        count: 1,
      })
    })

    it('immediately supplies the current model to a new listener', () => {
      const listener = vi.fn()

      const runtime = createRuntime(createProgram())

      runtime.start()

      runtime.dispatch({
        type: 'set',
        value: 10,
      })

      runtime.subscribe(listener)

      expect(listener).toHaveBeenCalledWith({
        count: 10,
      })
    })

    it('does not immediately call a listener before start', () => {
      const listener = vi.fn()

      const runtime = createRuntime(createProgram())

      runtime.subscribe(listener)

      expect(listener).not.toHaveBeenCalled()
    })

    it('allows listeners to unsubscribe', () => {
      const listener = vi.fn()

      const runtime = createRuntime(createProgram())

      runtime.start()

      const unsubscribe = runtime.subscribe(listener)

      listener.mockClear()

      unsubscribe()

      runtime.dispatch({
        type: 'increment',
      })

      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('subscriptions', () => {
    const strategy: SubscriptionStrategy<Subscription> = {
      key(subscription) {
        return subscription.id
      },

      equals(left, right) {
        return (
          left.type === right.type &&
          left.id === right.id &&
          left.value === right.value
        )
      },
    }

    it('starts subscriptions returned by subscriptions()', () => {
      const runSubscription = vi.fn(() => vi.fn())

      const runtime = createRuntime(
        createProgram({
          subscriptions() {
            return [
              {
                type: 'test',
                id: 'subscription-1',
                value: 1,
              },
            ]
          },

          runSubscription,

          subscriptionStrategy: strategy,
        })
      )

      runtime.start()

      expect(runSubscription).toHaveBeenCalledTimes(1)

      expect(runSubscription).toHaveBeenCalledWith(
        {
          type: 'test',
          id: 'subscription-1',
          value: 1,
        },
        expect.any(Function)
      )
    })

    it('does not restart an unchanged subscription', () => {
      const runSubscription = vi.fn(() => vi.fn())

      const runtime = createRuntime(
        createProgram({
          subscriptions() {
            return [
              {
                type: 'test',
                id: 'subscription-1',
                value: 1,
              },
            ]
          },

          runSubscription,

          subscriptionStrategy: strategy,
        })
      )

      runtime.start()

      runtime.dispatch({
        type: 'increment',
      })

      runtime.dispatch({
        type: 'increment',
      })

      expect(runSubscription).toHaveBeenCalledTimes(1)
    })

    it('restarts a subscription when its configuration changes', () => {
      const unsubscribe = vi.fn()

      const runSubscription = vi.fn(() => unsubscribe)

      const runtime = createRuntime(
        createProgram({
          subscriptions(model) {
            return [
              {
                type: 'test',
                id: 'subscription-1',
                value: model.count,
              },
            ]
          },

          runSubscription,

          subscriptionStrategy: strategy,
        })
      )

      runtime.start()

      expect(runSubscription).toHaveBeenCalledTimes(1)

      runtime.dispatch({
        type: 'increment',
      })

      expect(unsubscribe).toHaveBeenCalledTimes(1)

      expect(runSubscription).toHaveBeenCalledTimes(2)

      expect(runSubscription).toHaveBeenLastCalledWith(
        {
          type: 'test',
          id: 'subscription-1',
          value: 1,
        },
        expect.any(Function)
      )
    })

    it('stops subscriptions that disappear', () => {
      const unsubscribe = vi.fn()

      const runtime = createRuntime(
        createProgram({
          subscriptions(model) {
            if (model.count === 0) {
              return [
                {
                  type: 'test',
                  id: 'subscription-1',
                  value: 0,
                },
              ]
            }

            return []
          },

          runSubscription() {
            return unsubscribe
          },

          subscriptionStrategy: strategy,
        })
      )

      runtime.start()

      runtime.dispatch({
        type: 'increment',
      })

      expect(unsubscribe).toHaveBeenCalledTimes(1)
    })

    it('allows subscriptions to dispatch messages', () => {
      let dispatch: Dispatch<Msg> | undefined

      const runSubscription: SubscriptionHandler<Subscription, Msg> = (
        _subscription,
        runtimeDispatch
      ) => {
        dispatch = runtimeDispatch

        return () => {}
      }

      const runtime = createRuntime(
        createProgram({
          subscriptions() {
            return [
              {
                type: 'test',
                id: 'subscription-1',
                value: 0,
              },
            ]
          },

          runSubscription,

          subscriptionStrategy: strategy,
        })
      )

      runtime.start()

      dispatch?.({
        type: 'subscriptionEvent',
        value: 77,
      })

      expect(runtime.model).toEqual({
        count: 77,
      })
    })

    it('throws for duplicate subscription keys', () => {
      const runtime = createRuntime(
        createProgram({
          subscriptions() {
            return [
              {
                type: 'test',
                id: 'same',
                value: 1,
              },
              {
                type: 'test',
                id: 'same',
                value: 2,
              },
            ]
          },

          runSubscription() {
            return () => {}
          },

          subscriptionStrategy: strategy,
        })
      )

      expect(() => {
        runtime.start()
      }).toThrow('Duplicate subscription key: same')
    })
  })

  describe('stop', () => {
    it('marks the runtime as stopped', () => {
      const runtime = createRuntime(createProgram())

      runtime.start()

      runtime.stop()

      expect(runtime.running).toBe(false)
    })

    it('stops all active subscriptions', () => {
      const unsubscribe1 = vi.fn()
      const unsubscribe2 = vi.fn()

      const strategy: SubscriptionStrategy<Subscription> = {
        key(subscription) {
          return subscription.id
        },

        equals(left, right) {
          return left.id === right.id
        },
      }

      const runtime = createRuntime(
        createProgram({
          subscriptions() {
            return [
              {
                type: 'test',
                id: 'one',
                value: 1,
              },
              {
                type: 'test',
                id: 'two',
                value: 2,
              },
            ]
          },

          runSubscription(subscription) {
            return subscription.id === 'one' ? unsubscribe1 : unsubscribe2
          },

          subscriptionStrategy: strategy,
        })
      )

      runtime.start()

      runtime.stop()

      expect(unsubscribe1).toHaveBeenCalledTimes(1)

      expect(unsubscribe2).toHaveBeenCalledTimes(1)
    })

    it('is safe to call stop more than once', () => {
      const runtime = createRuntime(createProgram())

      runtime.start()

      expect(() => {
        runtime.stop()
        runtime.stop()
      }).not.toThrow()
    })
  })
})
