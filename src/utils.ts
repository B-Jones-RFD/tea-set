import { type UpdateResult } from './types.js'

/**
 * Creates an update result containing the given model with no effects.
 *
 * Use `none` when handling a message changes the application model but does
 * not require any interaction with the outside world.
 *
 * This is equivalent to returning:
 *
 * ```ts
 * {
 *   model,
 *   effects: [],
 * }
 * ```
 *
 * @typeParam Model - The application's state model.
 * @typeParam Effect - The effects that can be produced by the application.
 *
 * @param model - The model to return as the next application state.
 *
 * @returns An {@link UpdateResult} containing the model and an empty list of
 * effects.
 *
 * @example
 * ```ts
 * function update(
 *   model: Model,
 *   message: Msg,
 * ): UpdateResult<Model, Effect> {
 *   switch (message.type) {
 *     case "increment":
 *       return none({
 *         ...model,
 *         count: model.count + 1,
 *       });
 *   }
 * }
 * ```
 */
export function none<Model, Effect>(model: Model): UpdateResult<Model, Effect> {
  return {
    model,
    effects: [],
  }
}

/**
 * Creates an update result containing the given model and a single effect.
 *
 * Use `withEffect` when handling a message produces a new application state
 * and requires an interaction with the outside world, such as an HTTP request,
 * database operation, file operation, or other side effect.
 *
 * The effect is not executed by this function. It is returned as data and is
 * later interpreted by the runtime using the program's effect handler.
 *
 * This is equivalent to returning:
 *
 * ```ts
 * {
 *   model,
 *   effects: [effect],
 * }
 * ```
 *
 * @typeParam Model - The application's state model.
 * @typeParam Effect - The effects that can be produced by the application.
 *
 * @param model - The model to return as the next application state.
 * @param effect - The effect to be executed by the runtime.
 *
 * @returns An {@link UpdateResult} containing the model and the specified
 * effect.
 *
 * @example
 * ```ts
 * function update(
 *   model: Model,
 *   message: Msg,
 * ): UpdateResult<Model, Effect> {
 *   switch (message.type) {
 *     case "todos/loadRequested":
 *       return withEffect(
 *         {
 *           ...model,
 *           loading: true,
 *         },
 *         {
 *           type: "todos/load",
 *         },
 *       );
 *   }
 * }
 * ```
 */
export function withEffect<Model, Effect>(
  model: Model,
  effect: Effect
): UpdateResult<Model, Effect> {
  return {
    model,
    effects: [effect],
  }
}

/**
 * Creates an update result containing the given model and multiple effects.
 *
 * Use `withEffects` when handling a message produces a new application state
 * and requires multiple interactions with the outside world.
 *
 * The effects are not executed by this function. They are returned as data and
 * are later interpreted by the runtime using the program's effect handler.
 * Effects may execute asynchronously and concurrently depending on the runtime
 * implementation.
 *
 * This is equivalent to returning:
 *
 * ```ts
 * {
 *   model,
 *   effects,
 * }
 * ```
 *
 * @typeParam Model - The application's state model.
 * @typeParam Effect - The effects that can be produced by the application.
 *
 * @param model - The model to return as the next application state.
 * @param effects - The effects to be executed by the runtime.
 *
 * @returns An {@link UpdateResult} containing the model and the specified
 * effects.
 *
 * @example
 * ```ts
 * function update(
 *   model: Model,
 *   message: Msg,
 * ): UpdateResult<Model, Effect> {
 *   switch (message.type) {
 *     case "todo/created":
 *       return withEffects(
 *         {
 *           ...model,
 *           todos: [...model.todos, message.todo],
 *         },
 *         [
 *           {
 *             type: "audit/write",
 *             event: "todo-created",
 *           },
 *           {
 *             type: "metrics/increment",
 *             name: "todos.created",
 *           },
 *         ],
 *       );
 *   }
 * }
 * ```
 */
export function withEffects<Model, Effect>(
  model: Model,
  effects: readonly Effect[]
): UpdateResult<Model, Effect> {
  return {
    model,
    effects,
  }
}
