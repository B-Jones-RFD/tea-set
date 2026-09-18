// app.ts — the parent: composes the search-box child through a Translator and
// models pages as a union (only one page is alive at a time).

import {
  Cmd,
  Sub,
  Internal,
  translate,
  updateChild,
  assertNever,
} from '@b-jones-rfd/tea-set'
import type { Dispatch, Program, Translator } from '@b-jones-rfd/tea-set'
import * as SearchBox from './search-box.ts'
import type { User } from './http.ts'

type Session = { readonly viewer: User | null }

type Page =
  | { kind: 'Home' }
  | { kind: 'Profile'; userId: string }
  | { kind: 'NotFound'; path: string }

export type Model = {
  readonly session: Session
  readonly page: Page
  readonly search: SearchBox.Model
}

export type Msg =
  | { kind: 'SearchMsg'; msg: SearchBox.Msg }
  | { kind: 'UrlChanged'; path: string }
  | { kind: 'SearchDismissed' }

export type Flags = { readonly path: string }

/** How the child's messages become ours. External events map to parent-level intents. */
const searchTranslator: Translator<
  SearchBox.InternalMsg,
  SearchBox.ExternalMsg,
  Msg
> = {
  onInternal: (msg) => ({ kind: 'SearchMsg', msg: Internal(msg) }),
  onExternal: (event) => {
    switch (event.kind) {
      case 'UserChosen':
        return { kind: 'UrlChanged', path: `/users/${event.user.id}` }
      case 'Dismissed':
        return { kind: 'SearchDismissed' }
      default:
        return assertNever(event)
    }
  },
}
const toParent = translate(searchTranslator)

const search = updateChild<
  Model,
  Msg,
  SearchBox.Model,
  SearchBox.InternalMsg,
  SearchBox.ExternalMsg
>({
  get: (model) => model.search,
  set: (model, search) => ({ ...model, search }),
  translator: searchTranslator,
  update: SearchBox.update,
})

const routeFor = (path: string): Page => {
  const profile = /^\/users\/([\w-]+)$/.exec(path)
  if (path === '/') return { kind: 'Home' }
  if (profile) return { kind: 'Profile', userId: profile[1] as string }
  return { kind: 'NotFound', path }
}

/** In a browser: `history.pushState(null, '', path)`. */
const pushUrl = (path: string): Cmd<Msg> =>
  Cmd.effect(() => console.log(`  [history] pushState ${path}`))

export const init = (flags: Flags): [Model, Cmd<Msg>] => {
  const [searchModel, searchCmd] = SearchBox.init()
  return [
    {
      session: { viewer: null },
      page: routeFor(flags.path),
      search: searchModel,
    },
    Cmd.map(toParent, searchCmd),
  ]
}

export const update = (msg: Msg, model: Model): [Model, Cmd<Msg>] => {
  switch (msg.kind) {
    case 'SearchMsg':
      return search(msg.msg, model)
    case 'UrlChanged':
      return [{ ...model, page: routeFor(msg.path) }, pushUrl(msg.path)]
    case 'SearchDismissed':
      return [model, Cmd.none]
    default:
      return assertNever(msg)
  }
}

/** Namespaced so a second SearchBox would get its own keys rather than sharing one. */
export const subscriptions = (model: Model): Sub<Msg> =>
  Sub.map('search', toParent, SearchBox.subscriptions(model.search))

export const view = (model: Model, dispatch: Dispatch<Msg>): void => {
  console.log(
    `[app] page=${JSON.stringify(model.page)} viewer=${model.session.viewer?.name ?? 'none'}`
  )
  // Html.map: hand the child a dispatch that wraps its messages on the way up.
  const childDispatch: Dispatch<SearchBox.Msg> = (msg) =>
    dispatch(toParent(msg))
  SearchBox.view(model.search, childDispatch)
}

export const program: Program<Flags, Model, Msg> = {
  init,
  update,
  subscriptions,
  view,
}
