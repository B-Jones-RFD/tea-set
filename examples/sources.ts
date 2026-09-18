// sources.ts — subscription sources. A source is declared with `Sub.fromSource`
// and only started by the runtime, which also stops and restarts it as its
// params change.

import { Sub } from 'tea-set'

/** Tick every `ms` milliseconds. The interval is part of the identity via params. */
export const everyMs = <Msg>(
  ms: number,
  toMsg: (now: number) => Msg
): Sub<Msg> =>
  Sub.fromSource('time/every', { ms }, ({ ms }, dispatch) => {
    const id = setInterval(() => dispatch(toMsg(Date.now())), ms)
    return () => clearInterval(id)
  })

// In a browser this would be `window.addEventListener('keydown', …)`. The
// examples run under Node, so keys come from a tiny in-memory bus instead.
type Listener = (key: string) => void
const listeners = new Set<Listener>()

/** Simulate a key press (what a browser would deliver as a keydown event). */
export const keyboard = {
  press(key: string): void {
    for (const listener of listeners) listener(key)
  },
  get listenerCount(): number {
    return listeners.size
  },
}

/** A key was pressed. Subscribed only while some model says it cares. */
export const onKeyDown = <Msg>(toMsg: (key: string) => Msg): Sub<Msg> =>
  Sub.fromSource('keyboard/keydown', null, (_params, dispatch) => {
    const listener: Listener = (key) => dispatch(toMsg(key))
    listeners.add(listener)
    return () => listeners.delete(listener)
  })
