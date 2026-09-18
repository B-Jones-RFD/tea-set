// counter.ts — a single module: Model, Msg, init, update, subscriptions, view.

import { Cmd, Sub, assertNever } from '@b-jones-rfd/tea-set'
import type { Dispatch, Program } from '@b-jones-rfd/tea-set'
import { everyMs } from './sources.ts'

export type Model = {
  readonly count: number
  readonly step: number
  readonly ticking: boolean
}

export type Msg =
  | { kind: 'Incremented' }
  | { kind: 'Decremented' }
  | { kind: 'StepChanged'; step: number }
  | { kind: 'Reset' }
  | { kind: 'TickingToggled' }
  | { kind: 'Ticked'; at: number }

export const init = (): [Model, Cmd<Msg>] => [
  { count: 0, step: 1, ticking: false },
  Cmd.none,
]

export const update = (msg: Msg, model: Model): [Model, Cmd<Msg>] => {
  switch (msg.kind) {
    case 'Incremented':
      return [{ ...model, count: model.count + model.step }, Cmd.none]
    case 'Decremented':
      return [{ ...model, count: model.count - model.step }, Cmd.none]
    case 'StepChanged':
      return [{ ...model, step: msg.step }, Cmd.none]
    case 'Reset':
      return [{ ...model, count: 0 }, Cmd.none]
    case 'TickingToggled':
      return [{ ...model, ticking: !model.ticking }, Cmd.none]
    case 'Ticked':
      return [{ ...model, count: model.count + model.step }, Cmd.none]
    default:
      return assertNever(msg) // add a variant to Msg and this line stops compiling
  }
}

/** Only tick while `ticking`; the runtime starts/stops the interval as this changes. */
export const subscriptions = (model: Model): Sub<Msg> =>
  model.ticking ? everyMs(500, (at): Msg => ({ kind: 'Ticked', at })) : Sub.none

export const view = (model: Model, _dispatch: Dispatch<Msg>): void => {
  console.log(
    `[counter] count=${model.count} step=${model.step} ticking=${model.ticking}`
  )
}

export const program: Program<void, Model, Msg> = {
  init,
  update,
  subscriptions,
  view,
}
