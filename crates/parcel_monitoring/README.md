# parcel_monitoring

This crate wraps functionality provided to:

- Set-up sentry
- Set-up crash reporting
- Set-up tracing subscriber

It's provided as a separate crate than node-bindings so that we can provide example integration of the `minidumper`
system.

---

## Configuring monitoring / reporting

### Tracing

Tracing is turned off by default.

Parcel uses [`tracing`](https://github.com/tokio-rs/tracing) for logging and traces. This aims to aid debugging and bug
fixing.

- By default, traces/logs won't be written
- `PARCEL_TRACING_MODE=stdout` will write to standard-output
- `PARCEL_TRACING_MODE=file` will write to a temporary log file, with log rotation this file will be under
  `$TMPDIR/parcel_trace`

## Sentry integration

Sentry integration is turned off by default.

Parcel uses [sentry](https://sentry.io/) only on `canary` nightly releases for error monitoring.

- `PARCEL_ENABLE_SENTRY` will enable sentry integration
- `PARCEL_SENTRY_TAGS` should contain a JSON string with a dictionary of tags to add to sentry
- `PARCEL_SENTRY_DSN` should contain the Sentry DSN

## Crash reporting

Crash reporting is disabled by default.

Parcel uses
[crash-handling](https://github.com/EmbarkStudios/crash-handling/blob/e2891a4c6a8d43374ec63d791c7e6d42ff2e6545/README.md)
utilities to write [minidumps](https://github.com/EmbarkStudios/crash-handling/tree/main/minidumper) on crashes.

When this feature is enabled, the parcel process will try to IPC with a server process using the
[`minidumper`](https://github.com/EmbarkStudios/crash-handling/tree/main/minidumper) library. The server should write
and report the crash.

A default server implementation is not provided, but an example can be seen on `examples/sample_usage.rs`.

- `PARCEL_ENABLE_MINIDUMPER` will enable the minidumper client
- `PARCEL_MINIDUMPER_SERVER_PID_FILE` should contain a file path to a pid-file with the PID of the server process
- `PARCEL_MINIDUMPER_SERVER_SOCKET_NAME` should contain the path to the socket to use
