// run.ts — a Node smoke test: runs the counter and the app with console views.
//   pnpm run examples   (= pnpm run build && node examples/run.ts)

import { element, Internal } from 'tea-set'
import * as Counter from './counter.ts'
import * as App from './app.ts'
import type * as SearchBox from './search-box.ts'
import { keyboard } from './sources.ts'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

console.log('--- counter ---')
const counter = element({ program: Counter.program })
counter.dispatch({ kind: 'Incremented' })
counter.dispatch({ kind: 'StepChanged', step: 5 })
counter.dispatch({ kind: 'Incremented' })
counter.dispatch({ kind: 'TickingToggled' }) // interval subscription starts
await wait(1200) // two ticks
counter.dispatch({ kind: 'TickingToggled' }) // …and is torn down
counter.stop()

console.log('\n--- app ---')
const app = element({
  program: App.program,
  flags: { path: '/' },
  onError: (error, context) =>
    console.error('program error at', context.step, error),
})
const searchMsg = (msg: SearchBox.Msg): App.Msg => ({ kind: 'SearchMsg', msg })

app.dispatch(searchMsg(Internal({ kind: 'QueryChanged', query: 'a' })))
await wait(100) // the mocked request resolves and results render
console.log(`  (keydown listeners while open: ${keyboard.listenerCount})`)
keyboard.press('x') // ignored
keyboard.press('Escape') // child raises Dismissed → parent's SearchDismissed; panel closes
console.log(`  (keydown listeners after Escape: ${keyboard.listenerCount})`)

app.dispatch(searchMsg(Internal({ kind: 'QueryChanged', query: 'fail' })))
await wait(100) // failure shows up as RemoteData Failure

app.dispatch(searchMsg(Internal({ kind: 'QueryChanged', query: 'grace' })))
await wait(100)
app.dispatch(
  searchMsg(
    Internal({ kind: 'Chose', user: { id: 'grace', name: 'Grace Hopper' } })
  )
)
// child raises UserChosen → parent's UrlChanged → Profile page + pushState

app.dispatch(searchMsg(Internal({ kind: 'QueryChanged', query: 'evan' })))
app.stop() // aborts the in-flight request: no Received message will arrive
await wait(100)
console.log(
  '\nstopped; nothing above this line should have rendered after stop'
)
