// http.ts — an effect is a value you build, not a call you make. `searchUsers`
// returns a Task; nothing happens until the runtime performs the Cmd it is
// turned into. The "server" here is an in-memory stand-in for `fetch`.

import { Task } from 'tea-set'

export type User = { readonly id: string; readonly name: string }
export type HttpError =
  | { readonly kind: 'Network'; readonly reason: string }
  | { readonly kind: 'Aborted' }

const USERS: User[] = [
  { id: 'ada', name: 'Ada Lovelace' },
  { id: 'grace', name: 'Grace Hopper' },
  { id: 'evan', name: 'Evan Czaplicki' },
]

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(id)
        reject(signal.reason)
      },
      { once: true }
    )
  })

const toHttpError = (error: unknown): HttpError =>
  error instanceof Error && error.name === 'AbortError'
    ? { kind: 'Aborted' }
    : {
        kind: 'Network',
        reason: error instanceof Error ? error.message : String(error),
      }

/** GET /api/users?q=… — a query of "fail" simulates a server error. */
export const searchUsers = (query: string): Task<HttpError, User[]> =>
  Task.fromPromise(async (signal) => {
    await sleep(50, signal) // in a browser: `fetch(url, { signal })`
    if (query === 'fail') throw new Error('HTTP 500')
    const q = query.toLowerCase()
    return USERS.filter(
      (u) => u.name.toLowerCase().includes(q) || u.id.includes(q)
    )
  }, toHttpError)
