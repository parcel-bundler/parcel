import Foundation
import Synchronization
import Testing

@testable import ParcelPlugin

#if canImport(Darwin)
  import Darwin
#elseif canImport(Glibc)
  import Glibc
#endif

private func currentThread() -> UInt {
  #if canImport(Darwin)
    UInt(bitPattern: pthread_self())
  #else
    UInt(pthread_self())
  #endif
}

private actor Counter {
  var value = 0
  func increment() -> Int {
    value += 1
    return value
  }
}

@concurrent
private func offThread() async -> UInt {
  currentThread()
}

@Suite struct HostThreadExecutorTests {
  @Test(arguments: [true, false])
  func runsOnTheCallingThread(immediate: Bool) throws {
    let caller = currentThread()
    let result = runOnHostThread(immediate: immediate) { () async -> [UInt] in
      var threads = [currentThread()]
      _ = await Counter().increment()
      threads.append(currentThread())
      _ = await offThread()
      threads.append(currentThread())
      async let child = currentThread()
      threads.append(await child)
      return threads
    }
    #expect(try result.get() == [caller, caller, caller, caller])
  }

  @Test(arguments: [true, false])
  func workOptedOutOfThePreferenceRunsElsewhere(immediate: Bool) throws {
    let caller = currentThread()
    let result = runOnHostThread(immediate: immediate) { () async -> UInt in
      await withTaskGroup(of: UInt.self) { group in
        group.addTask(executorPreference: globalConcurrentExecutor) { currentThread() }
        return await group.next()!
      }
    }
    #expect(try result.get() != caller)
  }

  @Test(arguments: [true, false])
  func propagatesErrors(immediate: Bool) {
    struct Failure: Error {}
    let result = runOnHostThread(immediate: immediate) { () async throws -> Int in
      _ = await Counter().increment()
      throw Failure()
    }
    #expect(throws: Failure.self) { try result.get() }
  }

  /// A plugin call that calls the host, which calls back into the plugin on the
  /// same thread, as `Asset.resolve` does when this library is also a resolver.
  @Test(arguments: [true, false])
  func reentrantCallsNest(immediate: Bool) throws {
    let caller = currentThread()
    let result = runOnHostThread(immediate: immediate) { () async throws -> [UInt] in
      _ = await Counter().increment()
      // Synchronous, like a host function, from inside a job of the outer task.
      let inner = runOnHostThread(immediate: immediate) { () async -> UInt in
        _ = await Counter().increment()
        _ = await offThread()
        return currentThread()
      }
      _ = await offThread()
      return [try inner.get(), currentThread()]
    }
    #expect(try result.get() == [caller, caller])
  }

  @Test func manyConcurrentCallers() async {
    let counter = Counter()
    await withTaskGroup(of: Bool.self) { group in
      for _ in 0..<32 {
        group.addTask { @concurrent in
          // Mimics a Parcel worker thread: a plain blocking call.
          let caller = currentThread()
          let result = runOnHostThread { () async -> UInt in
            _ = await counter.increment()
            return currentThread()
          }
          return (try? result.get()) == caller
        }
      }
      for await onCaller in group {
        #expect(onCaller)
      }
    }
    #expect(await counter.value == 32)
  }

  /// Work that outlives the call goes to the global executor rather than hang.
  @Test func escapedWorkStillRuns() async {
    final class Flag: Sendable { let value = Atomic<Bool>(false) }
    let ran = Flag()
    let escaped = runOnHostThread { () async -> Task<Void, Never> in
      Task {
        try? await Task.sleep(for: .milliseconds(10))
        ran.value.store(true, ordering: .relaxed)
      }
    }
    await (try? escaped.get())?.value
    let didRun = ran.value.load(ordering: .relaxed)
    #expect(didRun)
  }
}

@Suite struct CallScopeTests {
  @Test func sharedAccessFromOtherThreads() async {
    let scope = CallScope("test")
    let values = await withTaskGroup(of: Int.self) { group in
      for value in 0..<16 {
        group.addTask { @concurrent in scope.shared("Test") { value } }
      }
      return await group.reduce(0, +)
    }
    #expect(values == (0..<16).reduce(0, +))
    scope.close()
  }

  @Test func exclusiveAccessOnTheOwningThread() {
    let scope = CallScope("test")
    #expect(scope.exclusive("Test") { 42 } == 42)
    scope.close()
  }

  @Test func usingAClosedScopeTraps() async {
    await #expect(processExitsWith: .failure) {
      let scope = CallScope("transform")
      scope.close()
      _ = scope.shared("Asset") { 0 }
    }
  }

  @Test func exclusiveAccessFromAnotherThreadTraps() async {
    await #expect(processExitsWith: .failure) {
      // Owned by a plain thread, like a Parcel worker, and used from Swift's pool.
      let scope = await withCheckedContinuation { continuation in
        Thread { continuation.resume(returning: CallScope("transform")) }.start()
      }
      _ = await Task.detached { @concurrent in scope.exclusive("Asset") { 0 } }.value
    }
  }
}
