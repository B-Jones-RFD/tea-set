import { describe, it, expect } from 'vitest'
import {
  NotAsked,
  Loading,
  Failure,
  Success,
  RemoteData,
} from '../src/remote-data.js'
import { Ok, Err } from '../src/result.js'
import { Just, Nothing } from '../src/maybe.js'
import type { RemoteData as RemoteDataType } from '../src/types.js'

const inc = (n: number) => n + 1

describe('RemoteData', () => {
  it('constructs tagged data', () => {
    expect(NotAsked).toEqual({ kind: 'NotAsked' })
    expect(Loading).toEqual({ kind: 'Loading' })
    expect(Failure('e')).toEqual({ kind: 'Failure', error: 'e' })
    expect(Success(1)).toEqual({ kind: 'Success', value: 1 })
  })

  it('map touches only Success', () => {
    expect(RemoteData.map(inc, Success(1))).toEqual(Success(2))
    expect(RemoteData.map(inc, NotAsked)).toEqual(NotAsked)
    expect(RemoteData.map(inc, Loading)).toEqual(Loading)
    expect(RemoteData.map(inc, Failure('e'))).toEqual(Failure('e'))
  })

  it('mapError touches only Failure', () => {
    expect(
      RemoteData.mapError((e: string) => e.length, Failure('abc'))
    ).toEqual(Failure(3))
    expect(RemoteData.mapError((e: string) => e.length, Success(1))).toEqual(
      Success(1)
    )
  })

  it('withDefault', () => {
    expect(RemoteData.withDefault(0, Success(5))).toBe(5)
    expect(RemoteData.withDefault(0, Loading)).toBe(0)
  })

  it('fromResult', () => {
    expect(RemoteData.fromResult(Ok(1))).toEqual(Success(1))
    expect(RemoteData.fromResult(Err('e'))).toEqual(Failure('e'))
  })

  it('toMaybe', () => {
    expect(RemoteData.toMaybe(Success(1))).toEqual(Just(1))
    expect(RemoteData.toMaybe(Failure('e'))).toEqual(Nothing)
    expect(RemoteData.toMaybe(NotAsked)).toEqual(Nothing)
  })

  it('isSuccess / isLoading narrow', () => {
    const d: RemoteDataType<string, number> = Success(1)
    expect(RemoteData.isSuccess(d)).toBe(true)
    if (RemoteData.isSuccess(d)) expect(d.value).toBe(1)
    expect(RemoteData.isLoading(d)).toBe(false)
    expect(RemoteData.isLoading(Loading)).toBe(true)
  })
})
