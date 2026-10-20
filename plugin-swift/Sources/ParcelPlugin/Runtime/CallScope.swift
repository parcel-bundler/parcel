import Synchronization

#if canImport(Darwin)
  import Darwin
#elseif canImport(Glibc)
  import Glibc
#elseif canImport(Musl)
  import Musl
#endif

/// The lifetime of the handles Parcel passes to one entry point.
///
/// Every handle points into the host's stack frame for that call, so using one
/// after the entry point returns is a use-after-free. Every handle holds the
/// scope of the call that created it and checks it before each host call:
///
/// - **Exclusive** access (the `Asset` being transformed, which the host holds as
///   `&mut`) must come from the thread Parcel called in on, while the call is
///   open. `Asset` is not `Sendable`, so the compiler already rules out most
///   other threads; this catches what it cannot, such as an escaped
///   unstructured task.
/// - **Shared** access (read-only views, safe to read concurrently) may come from
///   any thread. Off-thread readers count themselves in and out, and
///   ``close()`` waits for the count to drain, so the frame cannot disappear
///   between a passing check and the host call it guards.
///
/// A failed check traps: it is a programming error, like an out-of-bounds index,
/// and continuing would corrupt Parcel's memory.
final class CallScope: Sendable {
  private static let closedBit = 1 << (Int.bitWidth - 2)

  /// The entry point the handles came from, for the trap message.
  private let entry: StaticString
  private let owner: UInt
  /// Off-thread readers in flight, plus ``closedBit`` once the call returned.
  private let state = Atomic<Int>(0)

  init(_ entry: StaticString) {
    self.entry = entry
    self.owner = currentThread()
  }

  /// Runs a host call that needs exclusive access to a handle.
  @inline(__always)
  func exclusive<R>(_ handle: StaticString, _ body: () -> R) -> R {
    guard currentThread() == owner else {
      preconditionFailure(
        "\(handle) used off the thread Parcel called \(entry) on. It is not Sendable: keep it within the \(entry) call's own task."
      )
    }
    guard state.load(ordering: .relaxed) & Self.closedBit == 0 else {
      escaped(handle)
    }
    return body()
  }

  /// Runs a host call on a read-only handle.
  @inline(__always)
  func shared<R>(_ handle: StaticString, _ body: () -> R) -> R {
    if currentThread() == owner {
      // `close()` runs on this thread too, so it cannot race this call.
      guard state.load(ordering: .relaxed) & Self.closedBit == 0 else {
        escaped(handle)
      }
      return body()
    }
    guard state.wrappingAdd(1, ordering: .acquiring).newValue & Self.closedBit == 0 else {
      state.wrappingSubtract(1, ordering: .releasing)
      escaped(handle)
    }
    defer { state.wrappingSubtract(1, ordering: .releasing) }
    return body()
  }

  /// Ends the call. Every later use of its handles traps.
  func close() {
    state.bitwiseOr(Self.closedBit, ordering: .acquiringAndReleasing)
    // Off-thread readers that got in before the bit was set finish their host
    // call first. Rare, and each is a single host call long.
    while state.load(ordering: .acquiring) != Self.closedBit {
      sched_yield()
    }
  }

  private func escaped(_ handle: StaticString) -> Never {
    preconditionFailure(
      "\(handle) used after the \(entry) call it was passed to returned. Handles are valid only for the duration of that call."
    )
  }
}

@inline(__always)
private func currentThread() -> UInt {
  #if canImport(Darwin)
    UInt(bitPattern: pthread_self())
  #else
    UInt(pthread_self())
  #endif
}
