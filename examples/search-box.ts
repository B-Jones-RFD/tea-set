// search-box.ts — a child module with its own state, an HTTP task, a
// conditional subscription, and events for its parent. Its Msg is split:
// `Internal` messages it handles itself, `External` events it raises. It never
// imports the parent.

import {
  Cmd,
  Sub,
  Task,
  RemoteData,
  NotAsked,
  Loading,
  Internal,
  raise,
  assertNever,
} from 'tea-set'
import type { ChildMsg, Dispatch, Result } from 'tea-set'
import { searchUsers } from './http.ts'
import type { HttpError, User } from './http.ts'
import { onKeyDown } from './sources.ts'

export type Model = {
  readonly query: string
  readonly results: RemoteData<HttpError, User[]>
  readonly latestRequest: number
  readonly open: boolean
}

export type InternalMsg =
  | { kind: 'QueryChanged'; query: string }
  | { kind: 'Received'; requestId: number; result: Result<HttpError, User[]> }
  | { kind: 'KeyPressed'; key: string }
  | { kind: 'Chose'; user: User }

/** What the child tells its parent. The child never touches the parent's model. */
export type ExternalMsg =
  { kind: 'UserChosen'; user: User } | { kind: 'Dismissed' }

export type Msg = ChildMsg<InternalMsg, ExternalMsg>

export const init = (): [Model, Cmd<Msg>] => [
  { query: '', results: NotAsked, latestRequest: 0, open: false },
  Cmd.none,
]

export const update = (msg: Msg, model: Model): [Model, Cmd<Msg>] => {
  // External events are addressed to the parent; the parent's translator
  // intercepts them, so they never actually arrive here.
  if (msg.kind === 'External') return [model, Cmd.none]

  const internal = msg.msg
  switch (internal.kind) {
    case 'QueryChanged': {
      const requestId = model.latestRequest + 1
      return [
        {
          ...model,
          query: internal.query,
          results: Loading,
          latestRequest: requestId,
          open: true,
        },
        Task.attempt(
          (result): Msg => Internal({ kind: 'Received', requestId, result }),
          searchUsers(internal.query)
        ),
      ]
    }
    case 'Received':
      // Out-of-order replies are visible in the model, so they're easy to drop.
      if (internal.requestId !== model.latestRequest) return [model, Cmd.none]
      return [
        { ...model, results: RemoteData.fromResult(internal.result) },
        Cmd.none,
      ]
    case 'KeyPressed':
      return internal.key === 'Escape'
        ? [{ ...model, open: false }, raise({ kind: 'Dismissed' })]
        : [model, Cmd.none]
    case 'Chose':
      return [
        { ...model, open: false },
        raise({ kind: 'UserChosen', user: internal.user }),
      ]
    default:
      return assertNever(internal)
  }
}

/** Only listen for keys while the panel is open; the runtime adds and removes the listener. */
export const subscriptions = (model: Model): Sub<Msg> =>
  model.open
    ? onKeyDown((key): Msg => Internal({ kind: 'KeyPressed', key }))
    : Sub.none

export const view = (model: Model, _dispatch: Dispatch<Msg>): void => {
  const results = (() => {
    switch (model.results.kind) {
      case 'NotAsked':
        return '—'
      case 'Loading':
        return 'loading…'
      case 'Failure':
        return `failed (${model.results.error.kind})`
      case 'Success':
        return model.results.value.map((u) => u.name).join(', ') || 'no matches'
    }
  })()
  console.log(
    `  [search] query="${model.query}" open=${model.open} results: ${results}`
  )
}
