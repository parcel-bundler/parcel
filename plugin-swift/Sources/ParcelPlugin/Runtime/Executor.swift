import Dispatch
import Synchronization

/// A task executor whose jobs run on one host thread: the thread Parcel called the
/// current entry point on, which drains it until the entry point's task finishes.
///
/// Every ABI entry point is synchronous, but plugin methods are `async`. Rather
/// than block the host thread on a semaphore while the task runs on Swift's
/// global executor, the host thread *becomes* the executor. That has three
/// consequences the design depends on:
///
/// - Plugin code, its structured child tasks, and every nonisolated async
///   function they call run on the thread Parcel called in on, so the host
///   functions they call run there too — exactly as in a synchronous SDK.
/// - No thread of Swift's cooperative pool is ever blocked. The thread that waits
///   is Parcel's, and it does the task's own work while it waits.
/// - Re-entrancy is safe. When the plugin calls `Asset.resolve`, Parcel may call
///   back into this same library's resolver on the same thread, from inside a
///   job this executor is running. That nested call drains its own executor;
///   nothing is waiting on this one, since its task is blocked in the host call.
final class HostThreadExecutor: TaskExecutor, @unchecked Sendable {
  private struct State {
    var jobs: [UnownedJob] = []
    var finished = false
  }

  private let state = Mutex(State())
  /// Signalled once per enqueued job, and once more when the task finishes.
  private let wake = DispatchSemaphore(value: 0)

  func enqueue(_ job: consuming ExecutorJob) {
    let job = UnownedJob(job)
    let accepted = state.withLock { state in
      guard !state.finished else { return false }
      state.jobs.append(job)
      return true
    }
    if accepted {
      wake.signal()
    } else {
      // Work that outlived the entry point, e.g. an unstructured `Task {}` the
      // plugin started and did not await. Nothing drains this executor any more,
      // so run it elsewhere rather than leak it. Any handle it touches has been
      // closed, which `CallScope` reports.
      globalConcurrentExecutor.enqueue(job)
    }
  }

  /// Marks the task finished, which ends ``drain()``.
  func finish() {
    state.withLock { $0.finished = true }
    wake.signal()
  }

  /// Runs jobs on the current thread until ``finish()`` is called.
  func drain() {
    while true {
      wake.wait()
      let next: UnownedJob?? = state.withLock { state in
        if !state.jobs.isEmpty {
          return .some(state.jobs.removeFirst())
        }
        return state.finished ? .some(nil) : nil
      }
      switch next {
      case .some(.some(let job)):
        job.runSynchronously(on: asUnownedTaskExecutor())
      case .some(.none):
        return
      case .none:
        continue
      }
    }
  }
}

/// Holds the result of the task an entry point runs, for the host thread to read
/// once ``HostThreadExecutor/drain()`` returns.
private final class ResultBox<R>: @unchecked Sendable {
  var value: Result<R, any Error>?

  func run(_ body: () async throws -> sending R) async {
    do {
      value = .success(try await body())
    } catch {
      value = .failure(error)
    }
  }
}

/// Runs `body` as a task whose jobs execute on the current thread, and blocks
/// until it finishes. See ``HostThreadExecutor``.
///
/// `immediate: false` forces the path taken before macOS 26, for tests.
func runOnHostThread<R>(
  immediate: Bool = true,
  _ body: sending @escaping () async throws -> sending R
) -> Result<R, any Error> {
  let executor = HostThreadExecutor()
  let box = ResultBox<R>()

  if #available(macOS 26, *), immediate {
    // Runs synchronously on this thread up to the first real suspension, so a
    // plugin method that never suspends finishes without touching the queue.
    Task.immediate(executorPreference: executor) {
      await box.run(body)
      executor.finish()
    }
  } else {
    Task(executorPreference: executor) {
      await box.run(body)
      executor.finish()
    }
  }
  executor.drain()

  // `finish()` happens-before `drain()` returns, through the executor's lock.
  return box.value!
}
