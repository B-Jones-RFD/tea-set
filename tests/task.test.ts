import { describe, it, expect, vi } from 'vitest'
import { Task } from '../src/task.js'
import { Ok, Err } from '../src/result.js'
import type { Task as TaskType } from '../src/types.js'

const live = () => new AbortController().signal
const run = <E, A>(t: TaskType<E, A>, signal: AbortSignal = live()) =>
  t.run(signal)

const inc = (n: number) => n + 1
const dbl = (n: number) => n * 2

describe('Task constructors', () => {
  it('succeed / fail resolve to Ok / Err', async () => {
    expect(await run(Task.succeed(1))).toEqual(Ok(1))
    expect(await run(Task.fail('boom'))).toEqual(Err('boom'))
  })

  it('fromPromise wraps a resolved promise in Ok', async () => {
    const t = Task.fromPromise(async () => 'value', String)
    expect(await run(t)).toEqual(Ok('value'))
  })

  it('fromPromise maps a rejection through onError', async () => {
    const t = Task.fromPromise(
      async () => {
        throw new Error('nope')
      },
      (e) => (e instanceof Error ? e.message : 'unknown')
    )
    expect(await run(t)).toEqual(Err('nope'))
  })

  it('fromPromise maps a synchronous throw through onError', async () => {
    const t = Task.fromPromise(
      (): Promise<number> => {
        throw new Error('sync')
      },
      (e) => (e instanceof Error ? e.message : 'unknown')
    )
    expect(await run(t)).toEqual(Err('sync'))
  })

  it('building a task runs nothing', async () => {
    const fn = vi.fn(async () => 1)
    Task.map(inc, Task.fromPromise(fn, String))
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('Task combinators', () => {
  it('map obeys identity and composition', async () => {
    const t = Task.succeed(3)
    expect(await run(Task.map((x) => x, t))).toEqual(Ok(3))
    expect(await run(Task.map(dbl, Task.map(inc, t)))).toEqual(
      await run(Task.map((x) => dbl(inc(x)), t))
    )
  })

  it('map passes Err through untouched', async () => {
    expect(await run(Task.map(inc, Task.fail('e')))).toEqual(Err('e'))
  })

  it('mapError touches only Err', async () => {
    expect(
      await run(Task.mapError((e: string) => e.length, Task.fail('abc')))
    ).toEqual(Err(3))
    expect(
      await run(Task.mapError((e: string) => e.length, Task.succeed(1)))
    ).toEqual(Ok(1))
  })

  it('andThen chains and short-circuits on Err', async () => {
    const positive = (n: number): TaskType<string, number> =>
      n > 0 ? Task.succeed(n) : Task.fail('not positive')
    const second = vi.fn(positive)
    expect(await run(Task.andThen(positive, Task.succeed(2)))).toEqual(Ok(2))
    expect(await run(Task.andThen(positive, Task.succeed(0)))).toEqual(
      Err('not positive')
    )
    expect(await run(Task.andThen(second, Task.fail('first')))).toEqual(
      Err('first')
    )
    expect(second).not.toHaveBeenCalled()
  })

  it('map2 combines two successes and fails on either', async () => {
    const add = (a: number, b: number) => a + b
    expect(await run(Task.map2(add, Task.succeed(1), Task.succeed(2)))).toEqual(
      Ok(3)
    )
    expect(await run(Task.map2(add, Task.fail('a'), Task.succeed(2)))).toEqual(
      Err('a')
    )
    expect(await run(Task.map2(add, Task.succeed(1), Task.fail('b')))).toEqual(
      Err('b')
    )
  })

  it('sequence collects in order and stops at the first Err', async () => {
    const order: number[] = []
    const step = (n: number): TaskType<string, number> =>
      Task.fromPromise(async () => {
        order.push(n)
        return n
      }, String)
    expect(await run(Task.sequence([step(1), step(2), step(3)]))).toEqual(
      Ok([1, 2, 3])
    )
    expect(order).toEqual([1, 2, 3])

    const third = vi.fn(async () => 3)
    const seq = Task.sequence<string, number>([
      step(1),
      Task.fail('stop'),
      Task.fromPromise(third, String),
    ])
    expect(await run(seq)).toEqual(Err('stop'))
    expect(third).not.toHaveBeenCalled()
    expect(await run(Task.sequence([]))).toEqual(Ok([]))
  })
})

describe('Task cancellation', () => {
  it('does not start work when the signal is already aborted', async () => {
    const fn = vi.fn(async () => 1)
    const controller = new AbortController()
    controller.abort()
    const t = Task.fromPromise(fn, (e) =>
      e instanceof Error ? e.name : 'unknown'
    )
    expect(await run(t, controller.signal)).toEqual(Err('AbortError'))
    expect(fn).not.toHaveBeenCalled()
  })

  it('hands the same signal to the work so it can observe an abort mid-flight', async () => {
    const controller = new AbortController()
    const t = Task.fromPromise(
      (signal) =>
        new Promise<string>((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason))
        }),
      (e) => (e instanceof Error ? e.name : 'unknown')
    )
    const pending = run(t, controller.signal)
    controller.abort()
    expect(await pending).toEqual(Err('AbortError'))
  })

  it('a later step in a chain sees the abort and does not run', async () => {
    const controller = new AbortController()
    const second = vi.fn(async () => 2)
    const t = Task.andThen(
      () => Task.fromPromise(second, String),
      Task.fromPromise(async () => {
        controller.abort()
        return 1
      }, String)
    )
    const result = await run(t, controller.signal)
    expect(result.kind).toBe('Err')
    expect(second).not.toHaveBeenCalled()
  })
})

describe('Task.perform / Task.attempt', () => {
  it('build Cmd data without running the task', async () => {
    const fn = vi.fn(async () => 1)
    const t = Task.fromPromise(fn, String)
    const attempt = Task.attempt((r) => ({ kind: 'Got', r }), t)
    expect(attempt.kind).toBe('Attempt')
    if (attempt.kind === 'Attempt') {
      expect(attempt.task).toBe(t)
      expect(attempt.toMsg(Ok(1))).toEqual({ kind: 'Got', r: Ok(1) })
    }
    const perform = Task.perform(
      (n: number) => ({ kind: 'Tick', n }),
      Task.succeed(1)
    )
    expect(perform.kind).toBe('Perform')
    if (perform.kind === 'Perform')
      expect(perform.toMsg(1)).toEqual({ kind: 'Tick', n: 1 })
    expect(fn).not.toHaveBeenCalled()
  })
})
