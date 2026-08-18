// runtime.types.test.ts

import { describe, expectTypeOf, it } from 'vitest'

import { createRuntime, type Program } from '../src/index.js'

describe('Runtime types', () => {
  it('creates a runtime without flags', () => {
    const program: Program<number, string, never> = {
      init() {
        return {
          model: 0,
          effects: [],
        }
      },

      update(model) {
        return {
          model,
          effects: [],
        }
      },

      runEffect() {},
    }

    const runtime = createRuntime(program)

    expectTypeOf(runtime.start).toEqualTypeOf<() => void>()
  })

  it('requires flags when Flags is specified', () => {
    type Flags = {
      initial: number
    }

    const program: Program<number, string, never, never, Flags> = {
      init(flags) {
        return {
          model: flags.initial,
          effects: [],
        }
      },

      update(model) {
        return {
          model,
          effects: [],
        }
      },

      runEffect() {},
    }

    const runtime = createRuntime(program)

    expectTypeOf(runtime.start).toEqualTypeOf<(flags: Flags) => void>()
  })
})
