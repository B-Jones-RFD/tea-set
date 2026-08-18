# tea-set

A small, type-safe runtime for building TypeScript applications using
**The Elm Architecture**.

The package provides the primitives and runtime machinery for modeling
your application as a pure state machine:

``` text
Msg → update(Model, Msg) → Model + Effects
                             │
                             ▼
                       Effect Handler
                             │
                             ▼
                            Msg
```

Long-lived external event sources are modeled using subscriptions:

``` text
Model → subscriptions(Model) → Subscriptions
                                  │
                                  ▼
                         Subscription Handler
                                  │
                                  ▼
                                 Msg
```

The runtime manages message dispatch, sequential state transitions,
asynchronous effects, subscription lifecycles, cancellation, and model
observers while leaving your application's domain model and effect types entirely under your control.

## Features

-   Type-safe `Model`, `Msg`, `Effect`, `Subscription`, and `Flags`
-   Pure `update` functions
-   Elm-style initialization
-   Declarative effects
-   Declarative subscriptions
-   Sequential message processing
-   Concurrent asynchronous effects
-   Effect cancellation with `AbortSignal`
-   Automatic subscription lifecycle management
-   Model observers
-   Type-safe startup flags
-   Framework-independent
-   Zero application architecture dependencies

## Installation

Using pnpm:

``` bash
pnpm add @b-jones-rfd/tea-set
```

Using npm:

``` bash
npm install @b-jones-rfd/tea-set
```

## Quick Start

Define your application's model:

``` ts
type Model = Readonly<{
  count: number;
}>;
```

Define the messages your application can receive:

``` ts
type Msg =
  | { type: "increment" }
  | { type: "decrement" }
  | { type: "save" }
  | { type: "saved" };
```

Define the effects your application can request:

``` ts
type Effect =
  | {
      type: "save";
      count: number;
    };
```

Then create a program:

``` ts
import {
  createRuntime,
  none,
  withEffect,
  type Program,
} from "@b-jones-rfd/tea-set";

const program: Program<Model, Msg, Effect> = {
  init() {
    return none({ count: 0 });
  },

  update(model, msg) {
    switch (msg.type) {
      case "increment":
        return none({ count: model.count + 1 });

      case "decrement":
        return none({ count: model.count - 1 });

      case "save":
        return withEffect(model, {
          type: "save",
          count: model.count,
        });

      case "saved":
        return none(model);
    }
  },

  async runEffect(effect, dispatch, signal) {
    switch (effect.type) {
      case "save":
        await saveCount(effect.count, signal);
        dispatch({ type: "saved" });
        return;
    }
  },
};
```

Create and start the runtime:

``` ts
const runtime = createRuntime(program);

runtime.start();
runtime.dispatch({ type: "increment" });

console.log(runtime.model);
// { count: 1 }
```

## The Elm Architecture

The Elm Architecture organizes an application around a few concepts:

``` text
Model
Msg
init
update
effects
subscriptions
```

The central idea is that application state transitions remain pure.

Instead of performing side effects directly:

``` ts
async function update(model: Model, msg: Msg) {
  const todos = await database.findTodos();

  return {
    ...model,
    todos,
  };
}
```

the update function describes the desired effect:

``` ts
function update(model: Model, msg: Msg) {
  return {
    model,
    effects: [
      {
        type: "todos/load",
      },
    ],
  };
}
```

The runtime passes that effect to an interpreter outside the
application's pure state-transition logic.

## Model

`Model` represents the complete application state managed by a runtime.
The package does not impose any structure on it.

``` ts
type Model = Readonly<{
  todos: readonly Todo[];
  loading: boolean;
  error?: string;
}>;
```

Immutable models are recommended because they make state transitions
easier to reason about and test.

## Messages

Messages describe events that have occurred or actions that have been
requested. Discriminated unions work particularly well:

``` ts
type Msg =
  | {
      type: "todo/createRequested";
      text: string;
    }
  | {
      type: "todo/created";
      todo: Todo;
    }
  | {
      type: "todo/createFailed";
      error: Error;
    };
```

Messages are the only way application state changes.

## Update

An update function receives the current model and a message:

``` ts
export type Update<Model, Msg, Effect> = (
  model: Model,
  message: Msg,
) => UpdateResult<Model, Effect>;
```

It returns the next model and zero or more effects:

``` ts
export type UpdateResult<Model, Effect> = Readonly<{
  model: Model;
  effects: readonly Effect[];
}>;
```

`update` should remain pure. Avoid performing operations such as
`fetch`, database queries, logging, timers, or filesystem writes inside
it. Instead, represent those operations as effects.

## Effects

An effect describes something the application wants the outside world to
do. The application owns its effect type.

``` ts
type Effect =
  | { type: "todo/load" }
  | { type: "todo/create"; text: string }
  | { type: "log"; message: string };
```

Effects are data. This makes them easy to inspect, test, log, and reason
about.

### Effect Handlers

Effects are interpreted using an `EffectHandler`:

``` ts
export type EffectHandler<Effect, Msg> = (
  effect: Effect,
  dispatch: Dispatch<Msg>,
  signal: AbortSignal,
) => void | Promise<void>;
```

Effect handlers interact with the outside world and communicate results
back to the application by dispatching messages. An effect may dispatch
zero, one, or multiple messages.

## Effect Concurrency

Effects are started independently. This allows asynchronous effects to
execute concurrently.

Application state transitions, however, remain sequential.

## Sequential Message Processing

One of the runtime's primary guarantees is:

> Only one `update` invocation is active at a time.

Messages are placed into an internal queue. Even when multiple
asynchronous effects complete concurrently, their resulting messages are
reduced sequentially. This prevents state updates from racing with one
another.

## Helper Functions

### `none`

Return a model without effects:

``` ts
return none({
  ...model,
  count: model.count + 1,
});
```

### `withEffect`

Return a model with one effect:

``` ts
return withEffect(model, {
  type: "todo/load",
});
```

### `withEffects`

Return a model with multiple effects:

``` ts
return withEffects(model, [
  { type: "audit/write" },
  { type: "metrics/increment" },
]);
```

## Initialization

Programs initialize themselves through `init`.

``` ts
const program: Program<Model, Msg, Effect> = {
  init() {
    return none({ count: 0 });
  },

  // ...
};
```

Initialization can also produce effects.

Starting the runtime with `runtime.start()` initializes the model,
publishes the initial model, initializes subscriptions, and executes
initialization effects.

## Startup Flags

Programs can define strongly typed startup configuration.

``` ts
type Flags = Readonly<{
  userId: string;
  environment: "development" | "production";
}>;
```

Specify the flags type on the program:

``` ts
const program: Program<
  Model,
  Msg,
  Effect,
  never,
  Flags
> = {
  init(flags) {
    return none({
      userId: flags.userId,
      todos: [],
    });
  },

  update,
  runEffect,
};
```

The runtime then requires flags:

``` ts
runtime.start({
  userId: "1234",
  environment: "production",
});
```

If no flags are defined, use `runtime.start()`.

## Subscriptions

Effects represent one-time operations from the application to the
outside world. Subscriptions represent long-lived external event sources
flowing into the application.

Typical subscriptions include:

-   timers
-   WebSockets
-   message queues
-   Redis pub/sub
-   filesystem watchers
-   process signals
-   event emitters
-   TCP connections

A subscription is also represented as data:

``` ts
type Subscription =
  | {
      type: "timer";
      intervalMs: number;
    }
  | {
      type: "shutdown";
    };
```

Subscriptions are derived from the current model:

``` ts
function subscriptions(
  model: Model,
): readonly Subscription[] {
  if (!model.started) {
    return [];
  }

  return [
    {
      type: "timer",
      intervalMs: 30_000,
    },
  ];
}
```

## Subscription Handlers

A subscription handler turns a subscription description into an active
external listener:

``` ts
export type SubscriptionHandler<Subscription, Msg> = (
  subscription: Subscription,
  dispatch: Dispatch<Msg>,
) => Unsubscribe;
```

Every subscription handler returns an unsubscribe function, allowing the
runtime to automatically clean up subscriptions when they are no longer
required.

## Subscription Identity

The runtime needs to determine whether subscriptions have been added,
removed, or changed.

Define a `SubscriptionStrategy`:

``` ts
const subscriptionStrategy = {
  key(subscription: Subscription) {
    switch (subscription.type) {
      case "timer":
        return "timer";

      case "shutdown":
        return "shutdown";
    }
  },

  equals(left: Subscription, right: Subscription) {
    return JSON.stringify(left) === JSON.stringify(right);
  },
};
```

The `key` identifies the logical subscription. `equals` determines
whether its configuration has changed.

For production applications, explicit structural equality is generally
preferable to `JSON.stringify`.

## Subscription Lifecycle

After every model transition, the runtime reevaluates
`subscriptions(model)` and compares the desired subscriptions to the
currently active subscriptions.

Subscriptions that disappear are automatically stopped. Subscriptions
whose configuration changes are stopped and restarted. Unchanged
subscriptions remain active.

## Observing the Model

Consumers can subscribe to model changes:

``` ts
const unsubscribe =
  runtime.subscribe(model => {
    console.log(model);
  });
```

The listener immediately receives the current model if the runtime has
already started. Future model transitions are also delivered.

Stop listening with:

``` ts
unsubscribe();
```

This mechanism can be used to integrate the runtime with UI frameworks
or server infrastructure.

## Cancellation

Each runtime owns an `AbortController`.

Effect handlers receive its signal:

``` ts
async function runEffect(
  effect: Effect,
  dispatch: Dispatch<Msg>,
  signal: AbortSignal,
) {
  const response = await fetch(effect.url, {
    signal,
  });

  // ...
}
```

Calling `runtime.stop()` aborts the signal. Effect handlers should pass
the signal to APIs that support cancellation and avoid dispatching
messages after cancellation.

## Stopping the Runtime

Call:

``` ts
runtime.stop();
```

Stopping:

-   marks the runtime as stopped
-   aborts active effects through the runtime's `AbortSignal`
-   stops active subscriptions
-   clears queued messages

Calling `stop()` more than once is safe. Messages cannot be dispatched
to a stopped runtime.

## Web Applications

The runtime is intentionally UI-framework independent.

A browser application can use model observers to render:

``` ts
const runtime = createRuntime(program);

runtime.subscribe(model => {
  document.body.innerHTML = render(model);
});

runtime.start();
```

DOM events become messages:

``` ts
button.addEventListener("click", () => {
  runtime.dispatch({
    type: "increment",
  });
});
```

## APIs and Server Applications

The same architecture works for server applications. An incoming HTTP
request can be translated into a message:

``` ts
runtime.dispatch({
  type: "http/requestReceived",
  requestId,
  method,
  path,
});
```

The update function can then produce effects for persistence,
authentication, HTTP responses, or other infrastructure operations.

This keeps HTTP, persistence, authentication, queues, and other
infrastructure outside the application's pure state-transition logic.

## Testing

Pure update functions are straightforward to test because they require
no mocks or infrastructure.

Using Vitest:

``` ts
import {
  describe,
  expect,
  it,
} from "vitest";

describe("update", () => {
  it("increments the counter", () => {
    const model = {
      count: 0,
    };

    const result = update(
      model,
      {
        type: "increment",
      },
    );

    expect(result.model).toEqual({
      count: 1,
    });

    expect(result.effects).toEqual([]);
  });
});
```

Effects can also be tested as data:

``` ts
it("requests a save", () => {
  const result = update(
    {
      count: 10,
    },
    {
      type: "save",
    },
  );

  expect(result.effects).toEqual([
    {
      type: "save",
      count: 10,
    },
  ]);
});
```

No database, HTTP server, filesystem, or mocking framework is necessary
to test the application's decision-making logic.

## Recommended Project Structure

``` text
src/
├── domain/
│   ├── todo.ts
│   └── user.ts
│
├── application/
│   ├── model.ts
│   ├── msg.ts
│   ├── effect.ts
│   ├── subscription.ts
│   ├── update.ts
│   └── subscriptions.ts
│
├── infrastructure/
│   ├── effects/
│   │   ├── todo.ts
│   │   ├── auth.ts
│   │   └── logging.ts
│   │
│   ├── subscriptions/
│   │   ├── timer.ts
│   │   └── process.ts
│   │
│   └── persistence/
│       └── todo-repository.ts
│
└── main.ts
```

The application describes what needs to happen. Infrastructure
determines how it happens.

## Design Principles

### State changes only through messages

External code should not modify the model directly.

### Update functions should be pure

Given the same model and message, `update` should return the same model
and effects.

### Effects should be data

Prefer:

``` ts
{
  type: "todo/save",
  todo,
}
```

over embedding an opaque function in the effect.

Data-based effects are easier to inspect, test, log, serialize, and
reason about.

### Infrastructure should interpret effects

The application describes intent. Infrastructure decides whether that
means SQLite, PostgreSQL, an HTTP service, or an in-memory
implementation.

### Long-lived listeners should be subscriptions

Use effects for operations that happen once. Use subscriptions for
things that remain active until the application no longer requires them.

### Messages are sequential; effects may be concurrent

The runtime serializes model transitions while allowing asynchronous
work to happen concurrently.

## Core API

The package exposes the following core types:

``` ts
Program<
  Model,
  Msg,
  Effect,
  Subscription,
  Flags
>

Runtime<
  Model,
  Msg,
  Flags
>

Update<
  Model,
  Msg,
  Effect
>

UpdateResult<
  Model,
  Effect
>

EffectHandler<
  Effect,
  Msg
>

Subscriptions<
  Model,
  Subscription
>

SubscriptionHandler<
  Subscription,
  Msg
>

SubscriptionStrategy<
  Subscription
>

Dispatch<Msg>

Unsubscribe
```

The primary runtime factory is:

``` ts
createRuntime(program)
```

Along with update-result helpers:

``` ts
none(model)

withEffect(model, effect)

withEffects(model, effects)
```

## Runtime Guarantees

The runtime is designed around a small set of guarantees:

1.  `update` is never executed concurrently.
2.  Messages are processed in dispatch order.
3.  Effects run only after their state transition completes.
4.  Effects may execute concurrently.
5.  Effect results re-enter the application as messages.
6.  Subscriptions are derived from the current model.
7.  Subscription lifecycles are managed automatically.
8.  Stopping the runtime aborts cancellable effects and active
    subscriptions.
9.  Application state changes only through `update`.

These guarantees allow application logic to remain deterministic even
when the surrounding environment is highly asynchronous.

## Philosophy

The package deliberately provides **architecture rather than
infrastructure**.

It does not know about:

-   React
-   Express
-   Hono
-   databases
-   HTTP clients
-   authentication
-   queues
-   logging frameworks
-   persistence libraries

Those concerns belong at the edges of the application.

The package provides the mechanism for connecting those edges to a pure
application core.

The result is an architecture where the center of the application is a
predictable, testable state machine and side effects are explicit values
interpreted at its boundaries.

## License

MIT
