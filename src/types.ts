export type Dispatch<Msg> = (message: Msg) => void

export type UpdateResult<Model, Effect> = Readonly<{
  model: Model
  effects: readonly Effect[]
}>

export type Init<Model, Effect, Flags = void> = (
  ...args: Flags extends void ? [] : [flags: Flags]
) => UpdateResult<Model, Effect>

export type Update<Model, Msg, Effect> = (
  model: Model,
  message: Msg
) => UpdateResult<Model, Effect>

export type EffectHandler<Effect, Msg> = (
  effect: Effect,
  dispatch: Dispatch<Msg>,
  signal: AbortSignal
) => void | Promise<void>

export type Subscriptions<Model, Subscription> = (
  model: Model
) => readonly Subscription[]

export type Unsubscribe = () => void

export type SubscriptionHandler<Subscription, Msg> = (
  subscription: Subscription,
  dispatch: Dispatch<Msg>
) => Unsubscribe

export interface SubscriptionStrategy<Subscription> {
  key(subscription: Subscription): string
  equals(left: Subscription, right: Subscription): boolean
}

export interface Program<
  Model,
  Msg,
  Effect,
  Subscription = never,
  Flags = void,
> {
  readonly init: Init<Model, Effect, Flags>
  readonly update: Update<Model, Msg, Effect>
  readonly runEffect: EffectHandler<Effect, Msg>
  readonly subscriptions?: Subscriptions<Model, Subscription>
  readonly runSubscription?: SubscriptionHandler<Subscription, Msg>
  readonly subscriptionStrategy?: SubscriptionStrategy<Subscription>
}

export interface Runtime<Model, Msg, Flags = void> {
  readonly model: Model | undefined
  readonly running: boolean

  start(...args: Flags extends void ? [] : [flags: Flags]): void
  dispatch(message: Msg): void
  subscribe(listener: (model: Model) => void): Unsubscribe
  stop(): void
}
