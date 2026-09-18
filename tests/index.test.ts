import { describe, it, expect, expectTypeOf } from 'vitest'
import * as tea from '../src/index.js'
import type {
  Maybe,
  Result,
  RemoteData,
  Task,
  Cmd,
  Sub,
  Program,
  Dispatch,
} from '../src/index.js'
import type * as T from '../src/types.js'

describe('public export surface', () => {
  const expectedValues = [
    // namespaces
    'Maybe',
    'Result',
    'RemoteData',
    'Task',
    'Cmd',
    'Sub',
    // constructors
    'Just',
    'Nothing',
    'Ok',
    'Err',
    'NotAsked',
    'Loading',
    'Failure',
    'Success',
    'Internal',
    'External',
    // helpers
    'assertNever',
    'raise',
    'translate',
    'delegate',
    'updateChild',
    'element',
    // testing
    'flattenCmd',
    'runCmd',
    'CmdError',
    'flattenSubs',
  ] as const

  it('exports every expected value', () => {
    for (const name of expectedValues) expect(tea, name).toHaveProperty(name)
  })

  it('exports nothing unexpected', () => {
    expect(Object.keys(tea).sort()).toEqual([...expectedValues].sort())
  })

  it('namespace objects carry the Elm-named utilities', () => {
    expect(Object.keys(tea.Maybe).sort()).toEqual(
      [
        'andThen',
        'fromNullable',
        'isJust',
        'isNothing',
        'map',
        'map2',
        'toNullable',
        'withDefault',
      ].sort()
    )
    expect(Object.keys(tea.Result).sort()).toEqual(
      [
        'andThen',
        'fromMaybe',
        'isErr',
        'isOk',
        'map',
        'mapError',
        'toMaybe',
        'withDefault',
      ].sort()
    )
    expect(Object.keys(tea.RemoteData).sort()).toEqual(
      [
        'fromResult',
        'isLoading',
        'isSuccess',
        'map',
        'mapError',
        'toMaybe',
        'withDefault',
      ].sort()
    )
    expect(Object.keys(tea.Task).sort()).toEqual(
      [
        'andThen',
        'attempt',
        'fail',
        'fromPromise',
        'map',
        'map2',
        'mapError',
        'perform',
        'sequence',
        'succeed',
      ].sort()
    )
    expect(Object.keys(tea.Cmd).sort()).toEqual(
      ['batch', 'effect', 'map', 'none'].sort()
    )
    expect(Object.keys(tea.Sub).sort()).toEqual(
      ['batch', 'fromSource', 'map', 'none'].sort()
    )
  })

  it('names double as types, identical to the definitions in types.ts', () => {
    expectTypeOf<Maybe<number>>().toEqualTypeOf<T.Maybe<number>>()
    expectTypeOf<Result<string, number>>().toEqualTypeOf<
      T.Result<string, number>
    >()
    expectTypeOf<RemoteData<string, number>>().toEqualTypeOf<
      T.RemoteData<string, number>
    >()
    expectTypeOf<Task<never, number>>().toEqualTypeOf<T.Task<never, number>>()
    expectTypeOf<Cmd<number>>().toEqualTypeOf<T.Cmd<number>>()
    expectTypeOf<Sub<number>>().toEqualTypeOf<T.Sub<number>>()
    // and the values slot into them
    const m: Maybe<number> = tea.Just(1)
    const r: Result<string, number> = tea.Ok(1)
    const d: RemoteData<string, number> = tea.Success(1)
    const t: Task<never, number> = tea.Task.succeed(1)
    const c: Cmd<number> = tea.Cmd.none
    const s: Sub<number> = tea.Sub.none
    expect([m, r, d, t, c, s]).toHaveLength(6)
    const program: Program<void, number, number> = {
      init: () => [0, tea.Cmd.none],
      update: (msg, model) => [model + msg, tea.Cmd.none],
      subscriptions: () => tea.Sub.none,
      view: (_model, dispatch: Dispatch<number>) => void dispatch,
    }
    expect(program.init()).toEqual([0, tea.Cmd.none])
  })
})
