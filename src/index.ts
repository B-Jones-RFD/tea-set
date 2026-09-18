// The package's public surface. Re-exports only.

// Types that have no namespace object. `Maybe`, `Result`, `RemoteData`,
// `Task`, `Cmd` and `Sub` are exported below, each as both a type and a namespace.
export type {
  ChildMsg,
  CmdLeaf,
  Dispatch,
  ElementOptions,
  ErrorContext,
  ErrorStep,
  Program,
  Running,
  SubSource,
  Teardown,
  Translator,
} from './types.js'

// Namespaces (type + value) and constructors
export { Maybe, Just, Nothing } from './maybe.js'
export { Result, Ok, Err, assertNever } from './result.js'
export {
  RemoteData,
  NotAsked,
  Loading,
  Failure,
  Success,
} from './remote-data.js'
export { Task } from './task.js'
export { Cmd } from './cmd.js'
export { Sub } from './sub.js'

// Parent / child composition
export {
  Internal,
  External,
  raise,
  translate,
  delegate,
  updateChild,
} from './compose.js'
export type { UpdateChildOptions } from './compose.js'

// Runtime
export { element } from './runtime.js'

// Test helpers
export { flattenCmd, runCmd, CmdError, flattenSubs } from './testing.js'
export type { RunCmdOptions } from './testing.js'
