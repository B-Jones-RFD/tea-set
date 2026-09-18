# tea-set

Utilities for writing programs in **The Elm Architecture** in TypeScript: `Cmd`, `Sub`, `Task`, `Maybe`, `Result`, `RemoteData`, parent/child composition, and a small runtime (`element`) that drives the `init` / `update` / `subscriptions` / `view` loop.

- **Framework-agnostic.** `view` is a callback you supply; render with whatever you like.
- **Zero runtime dependencies.** ESM with TypeScript declarations.
- **Commands are data.** A `Cmd` describes work; nothing runs until the runtime performs it, so `update` stays pure and testable.
- **Elm names.** If you know `Cmd.batch`, `Task.attempt`, `Maybe.withDefault`, `Sub.map`, you already know the API.

## Install

```sh
pnpm add @b-jones-rfd/tea-set
```

Requires Node ≥ 24 (or any modern browser); `AbortSignal` is used for cancellation.

## A complete program

```ts
import { Cmd, Sub, element, assertNever } from '@b-jones-rfd/tea-set'
import type { Program } from '@b-jones-rfd/tea-set'

type Model = { count: number; ticking: boolean }
type Msg = { kind: 'Incremented' } | { kind: 'TickingToggled' } | { kind: 'Ticked' }

const everyMs = <Msg>(ms: number, toMsg: () => Msg): Sub<Msg> =>
  Sub.fromSource('time/every', { ms }, ({ ms }, dispatch) => {
    const id = setInterval(() => dispatch(toMsg()), ms)
    return () => clearInterval(id)
  })

const program: Program<void, Model, Msg> = {
  init: () => [{ count: 0, ticking: false }, Cmd.none],

  update: (msg, model) => {
    switch (msg.kind) {
      case 'Incremented':
      case 'Ticked':
        return [{ ...model, count: model.count + 1 }, Cmd.none]
      case 'TickingToggled':
        return [{ ...model, ticking: !model.ticking }, Cmd.none]
      default:
        return assertNever(msg) // add a variant to Msg and this stops compiling
    }
  },

  // Declared, never started by hand: the runtime starts, restarts and stops sources
  // as the value returned here changes after each update.
  subscriptions: (model) => (model.ticking ? everyMs(1000, () => ({ kind: 'Ticked' })) : Sub.none),

  view: (model, dispatch) => {
    document.body.textContent = `count: ${model.count}`
    document.body.onclick = () => dispatch({ kind: 'Incremented' })
  },
}

const app = element({ program })
app.dispatch({ kind: 'TickingToggled' }) // an "incoming port": outside code can send a Msg
// later: app.stop() — tears down subscriptions and aborts in-flight tasks
```

`init(flags)` and `update(msg, model)` both return `[Model, Cmd<Msg>]`, Elm's `(Model, Cmd Msg)`.

## Effects as tasks

Wrap Promise-returning work in a `Task`; turn it into a `Cmd` with `Task.attempt` (may fail, delivers a `Result`) or `Task.perform` (cannot fail).

```ts
import { Task, RemoteData, Loading } from '@b-jones-rfd/tea-set'
import type { Result } from '@b-jones-rfd/tea-set'

type User = { id: string; name: string }
type HttpError = { kind: 'Network'; reason: string }

const searchUsers = (query: string): Task<HttpError, User[]> =>
  Task.fromPromise(
    async (signal) => {
      const res = await fetch(`/api/users?q=${encodeURIComponent(query)}`, { signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as User[]
    },
    (e) => ({ kind: 'Network', reason: e instanceof Error ? e.message : String(e) })
  )

// in update:
case 'QueryChanged':
  return [
    { ...model, results: Loading },
    Task.attempt((result: Result<HttpError, User[]>): Msg => ({ kind: 'Received', result }), searchUsers(msg.query)),
  ]
case 'Received':
  return [{ ...model, results: RemoteData.fromResult(msg.result) }, Cmd.none]
```

The runtime passes its `AbortSignal` to every task. `stop()` aborts it: in-flight work is cancelled and any result arriving afterwards is discarded — no `Msg` is dispatched. Thrown errors and rejections inside a task become `Err` via the `onError` mapper you give `fromPromise`.

`Cmd.effect((dispatch) => …)` is the escape hatch for effects that don't fit a task.

## Parent / child composition

A child's `Msg` is split with `ChildMsg<Internal, External>`: `Internal` messages it handles itself, `External` events it raises for its parent. The child never learns the parent's `Msg` type.

```ts
// search-box.ts (child)
import { Cmd, Internal, raise } from '@b-jones-rfd/tea-set'
import type { ChildMsg } from '@b-jones-rfd/tea-set'

export type InternalMsg = { kind: 'QueryChanged'; query: string } | { kind: 'Chose'; user: User }
export type ExternalMsg = { kind: 'UserChosen'; user: User }
export type Msg = ChildMsg<InternalMsg, ExternalMsg>

export const update = (msg: Msg, model: Model): [Model, Cmd<Msg>] => {
  if (msg.kind === 'External') return [model, Cmd.none] // addressed to the parent
  switch (msg.msg.kind) {
    case 'Chose':
      return [{ ...model, open: false }, raise({ kind: 'UserChosen', user: msg.msg.user })]
    // …
  }
}
```

```ts
// app.ts (parent)
import { Cmd, Sub, Internal, translate, updateChild } from '@b-jones-rfd/tea-set'
import type { Translator } from '@b-jones-rfd/tea-set'
import * as SearchBox from './search-box'

type Msg = { kind: 'SearchMsg'; msg: SearchBox.Msg } | { kind: 'UrlChanged'; path: string }

const searchTranslator: Translator<SearchBox.InternalMsg, SearchBox.ExternalMsg, Msg> = {
  onInternal: (msg) => ({ kind: 'SearchMsg', msg: Internal(msg) }),
  onExternal: (event) => ({ kind: 'UrlChanged', path: `/users/${event.user.id}` }),
}
const toParent = translate(searchTranslator)

const search = updateChild({
  get: (model: Model) => model.search,
  set: (model, search) => ({ ...model, search }),
  translator: searchTranslator,
  update: SearchBox.update,
})

// update:            case 'SearchMsg': return search(msg.msg, model)
// subscriptions:     Sub.map('search', toParent, SearchBox.subscriptions(model.search))
// view (Html.map):   SearchBox.view(model.search, (msg) => dispatch(toParent(msg)))
```

`Sub.map` namespaces subscription keys (`search::keyboard/keydown`), so two instances of the same child never collapse into one subscription. `delegate(f, [model, cmd])` is the lower-level piece `updateChild` is built on.

## API

Every namespace below is also a type of the same name (`const m: Maybe<number> = Maybe.map(…)`).

| Namespace | Members |
|---|---|
| `Cmd` | `none`, `batch`, `map`, `effect` |
| `Sub` | `none`, `batch`, `map(namespace, f, sub)`, `fromSource(key, params, start)` |
| `Task` | `succeed`, `fail`, `fromPromise`, `map`, `mapError`, `andThen`, `map2`, `sequence`, `perform`, `attempt` |
| `Maybe` | `map`, `map2`, `andThen`, `withDefault`, `isJust`, `isNothing`, `fromNullable`, `toNullable` |
| `Result` | `map`, `mapError`, `andThen`, `withDefault`, `toMaybe`, `fromMaybe`, `isOk`, `isErr` |
| `RemoteData` | `map`, `mapError`, `withDefault`, `fromResult`, `toMaybe`, `isSuccess`, `isLoading` |

| Constructors | |
|---|---|
| `Just`, `Nothing` | `Maybe` |
| `Ok`, `Err` | `Result` |
| `NotAsked`, `Loading`, `Failure`, `Success` | `RemoteData` |
| `Internal`, `External` | `ChildMsg` |

| Function | |
|---|---|
| `element({ program, flags?, onError? })` | Start a program; returns `{ dispatch, stop }` |
| `translate(translator)` | `ChildMsg → ParentMsg` |
| `delegate(f, [model, cmd])` | Map a child's `Cmd` into the parent's |
| `updateChild({ get, set, translator, update })` | A parent-shaped update step for one child |
| `raise(event)` | A `Cmd` that raises an `External` event |
| `assertNever(x)` | Exhaustiveness check for `switch` |

Types: `Program`, `Dispatch`, `ChildMsg`, `Translator`, `ElementOptions`, `ErrorContext`, `ErrorStep`, `Running`, `SubSource`, `CmdLeaf`, `Teardown`.

### Testing helpers

Because a `Cmd` is data, `update` can be tested without running anything:

```ts
import { flattenCmd, runCmd } from '@b-jones-rfd/tea-set'

const [model, cmd] = update({ kind: 'QueryChanged', query: 'ada' }, initialModel)
flattenCmd(cmd)           // → [{ kind: 'Attempt', task, toMsg }] — inspect without performing
await runCmd(cmd)         // → the Msgs it dispatches, once every task has settled
```

`runCmd` rejects with a `CmdError { step, cause }` if an effect or task fails. `flattenSubs(sub)` lists a subscription's `Source` leaves.

## Runtime semantics

- After each `update`: `view` is rendered, subscriptions are reconciled, then the returned `Cmd` is performed.
- Messages dispatched while `update` runs (from `view`, an effect, or a subscription) are queued and processed in order, never recursively.
- Subscriptions are reconciled by `key`: new keys start, missing keys are torn down, and a key whose `params` changed (structural equality on primitives, arrays, plain objects and `Date`s) is restarted. Put anything else — class instances, `Map`s — into the key string instead.
- **Errors.** If `update`, `view`, `subscriptions`, a source's `start`/teardown, a `Cmd.effect`, or a `perform`ed task fails, the runtime calls `onError(error, { step, msg })` if you supplied one, otherwise rethrows. The model is left as it was before the failing step. A throwing `init` always propagates from `element`.
- `stop()` tears down every subscription, aborts the program's `AbortSignal`, and ignores later `dispatch` calls.

## Examples

[`examples/`](./examples) contains a counter, a search-box child, and a parent app composing it, runnable under Node with `pnpm run examples`. They are type-checked with the tests but not published.

## License

Apache-2.0
