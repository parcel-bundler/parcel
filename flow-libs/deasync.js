// @flow

declare module 'deasync' {
  declare module.exports: {
    // TODO: Main callable signature
    loopWhile(() => boolean): void,
    runLoopOnce(): void,
    sleep(sleepTimeMs: number): void,
    ...
  };
}
