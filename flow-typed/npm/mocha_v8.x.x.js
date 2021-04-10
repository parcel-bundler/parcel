// flow-typed signature: 195cec6dc98ab7533f0eb927ee493f99
// flow-typed version: 1a6d5d1968/mocha_v8.x.x/flow_>=v0.104.x

declare interface $npm$mocha$SetupOptions {
  slow?: number;
  timeout?: number;
  ui?: string;
  globals?: Array<any>;
  reporter?: any;
  bail?: boolean;
  ignoreLeaks?: boolean;
  grep?: any;
}

declare type $npm$mocha$done = (error?: any) => any;

// declare interface $npm$mocha$SuiteCallbackContext {
//   timeout(ms: number): void;
//   retries(n: number): void;
//   slow(ms: number): void;
// }

// declare interface $npm$mocha$TestCallbackContext {
//   skip(): void;
//   timeout(ms: number): void;
//   retries(n: number): void;
//   slow(ms: number): void;
//   [index: string]: any;
// }

declare interface $npm$mocha$Suite {
  parent: $npm$mocha$Suite;
  title: string;
  fullTitle(): string;
}

declare type $npm$mocha$ContextDefinition = {|
  (description: string, callback: (/* this: $npm$mocha$SuiteCallbackContext */) => void): $npm$mocha$Suite;
  only(description: string, callback: (/* this: $npm$mocha$SuiteCallbackContext */) => void): $npm$mocha$Suite;
  skip(description: string, callback: (/* this: $npm$mocha$SuiteCallbackContext */) => void): void;
  timeout(ms: number): void;
|}

declare type $npm$mocha$TestDefinition = {|
  (expectation: string, callback?: (/* this: $npm$mocha$TestCallbackContext, */ done: $npm$mocha$done) => mixed): $npm$mocha$Test;
  only(expectation: string, callback?: (/* this: $npm$mocha$TestCallbackContext, */ done: $npm$mocha$done) => mixed): $npm$mocha$Test;
  skip(expectation: string, callback?: (/* this: $npm$mocha$TestCallbackContext, */ done: $npm$mocha$done) => mixed): void;
  timeout(ms: number): void;
  state: 'failed' | 'passed';
|}

declare interface $npm$mocha$Runner {}

declare class $npm$mocha$BaseReporter {
  stats: {
    suites: number,
    tests: number,
    passes: number,
    pending: number,
    failures: number,
    ...
  };

  constructor(runner: $npm$mocha$Runner): $npm$mocha$BaseReporter;
}

declare class $npm$mocha$DocReporter extends $npm$mocha$BaseReporter {}
declare class $npm$mocha$DotReporter extends $npm$mocha$BaseReporter {}
declare class $npm$mocha$HTMLReporter extends $npm$mocha$BaseReporter {}
declare class $npm$mocha$HTMLCovReporter extends $npm$mocha$BaseReporter {}
declare class $npm$mocha$JSONReporter extends $npm$mocha$BaseReporter {}
declare class $npm$mocha$JSONCovReporter extends $npm$mocha$BaseReporter {}
declare class $npm$mocha$JSONStreamReporter extends $npm$mocha$BaseReporter {}
declare class $npm$mocha$LandingReporter extends $npm$mocha$BaseReporter {}
declare class $npm$mocha$ListReporter extends $npm$mocha$BaseReporter {}
declare class $npm$mocha$MarkdownReporter extends $npm$mocha$BaseReporter {}
declare class $npm$mocha$MinReporter extends $npm$mocha$BaseReporter {}
declare class $npm$mocha$NyanReporter extends $npm$mocha$BaseReporter {}
declare class $npm$mocha$ProgressReporter extends $npm$mocha$BaseReporter {
  constructor(runner: $npm$mocha$Runner, options?: {
    open?: string,
    complete?: string,
    incomplete?: string,
    close?: string,
    ...
  }): $npm$mocha$ProgressReporter;
}
declare class $npm$mocha$SpecReporter extends $npm$mocha$BaseReporter {}
declare class $npm$mocha$TAPReporter extends $npm$mocha$BaseReporter {}
declare class $npm$mocha$XUnitReporter extends $npm$mocha$BaseReporter {
  constructor(runner: $npm$mocha$Runner, options?: any): $npm$mocha$XUnitReporter;
}

declare class $npm$mocha$Mocha {
  currentTest: $npm$mocha$TestDefinition;
  constructor(options?: {
    grep?: RegExp,
    ui?: string,
    reporter?: string,
    timeout?: number,
    reporterOptions?: any,
    slow?: number,
    bail?: boolean,
    ...
  }): $npm$mocha$Mocha;
  setup(options: $npm$mocha$SetupOptions): this;
  bail(value?: boolean): this;
  addFile(file: string): this;
  reporter(name: string): this;
  reporter(reporter: (runner: $npm$mocha$Runner, options: any) => any): this;
  ui(value: string): this;
  grep(value: string): this;
  grep(value: RegExp): this;
  invert(): this;
  ignoreLeaks(value: boolean): this;
  checkLeaks(): this;
  throwError(error: Error): void;
  growl(): this;
  globals(value: string): this;
  globals(values: Array<string>): this;
  useColors(value: boolean): this;
  useInlineDiffs(value: boolean): this;
  timeout(value: number): this;
  slow(value: number): this;
  enableTimeouts(value: boolean): this;
  asyncOnly(value: boolean): this;
  noHighlighting(value: boolean): this;
  run(onComplete?: (failures: number) => void): $npm$mocha$Runner;

  static reporters: {
    Doc: $npm$mocha$DocReporter,
    Dot: $npm$mocha$DotReporter,
    HTML: $npm$mocha$HTMLReporter,
    HTMLCov: $npm$mocha$HTMLCovReporter,
    JSON: $npm$mocha$JSONReporter,
    JSONCov: $npm$mocha$JSONCovReporter,
    JSONStream: $npm$mocha$JSONStreamReporter,
    Landing: $npm$mocha$LandingReporter,
    List: $npm$mocha$ListReporter,
    Markdown: $npm$mocha$MarkdownReporter,
    Min: $npm$mocha$MinReporter,
    Nyan: $npm$mocha$NyanReporter,
    Progress: $npm$mocha$ProgressReporter,
    ...
  };
}

// declare interface $npm$mocha$HookCallbackContext {
//   skip(): void;
//   timeout(ms: number): void;
//   [index: string]: any;
// }

declare interface $npm$mocha$Runnable {
  title: string;
  fn: Function;
  async: boolean;
  sync: boolean;
  timedOut: boolean;
}

declare interface $npm$mocha$Test extends $npm$mocha$Runnable {
  parent: $npm$mocha$Suite;
  pending: boolean;
  state: 'failed' | 'passed' | void;
  fullTitle(): string;
  timeout(ms: number): void;
}

// declare interface $npm$mocha$BeforeAndAfterContext extends $npm$mocha$HookCallbackContext {
//   currentTest: $npm$mocha$Test;
// }

declare var mocha: $npm$mocha$Mocha;
declare var describe: $npm$mocha$ContextDefinition;
declare var xdescribe: $npm$mocha$ContextDefinition;
declare var context: $npm$mocha$ContextDefinition;
declare var suite: $npm$mocha$ContextDefinition;
declare var it: $npm$mocha$TestDefinition;
declare var xit: $npm$mocha$TestDefinition;
declare var test: $npm$mocha$TestDefinition;
declare var specify: $npm$mocha$TestDefinition;

type Run = () => void;

declare var run: Run;

type Setup = (callback: (/* this: $npm$mocha$BeforeAndAfterContext, */ done: $npm$mocha$done) => mixed) => void;
type Teardown = (callback: (/* this: $npm$mocha$BeforeAndAfterContext, */ done: $npm$mocha$done) => mixed) => void;
type SuiteSetup = (callback: (/* this: $npm$mocha$HookCallbackContext, */ done: $npm$mocha$done) => mixed) => void;
type SuiteTeardown = (callback: (/* this: $npm$mocha$HookCallbackContext, */ done: $npm$mocha$done) => mixed) => void;
type Before =
  | (callback: (/* this: $npm$mocha$HookCallbackContext, */ done: $npm$mocha$done) => mixed) => void
  | (description: string, callback: (/* this: $npm$mocha$HookCallbackContext, */ done: $npm$mocha$done) => mixed) => void;
type After =
  | (callback: (/* this: $npm$mocha$HookCallbackContext, */ done: $npm$mocha$done) => mixed) => void
  | (description: string, callback: (/* this: $npm$mocha$HookCallbackContext, */ done: $npm$mocha$done) => mixed) => void;
type BeforeEach =
  | (callback: (/* this: $npm$mocha$BeforeAndAfterContext, */ done: $npm$mocha$done) => mixed) => void
  | (description: string, callback: (/* this: $npm$mocha$BeforeAndAfterContext, */ done: $npm$mocha$done) => mixed) => void;
type AfterEach =
  | (callback: (/* this: $npm$mocha$BeforeAndAfterContext, */ done: $npm$mocha$done) => mixed) => void
  | (description: string, callback: (/* this: $npm$mocha$BeforeAndAfterContext, */ done: $npm$mocha$done) => mixed) => void;


declare var setup: Setup;
declare var teardown: Teardown;
declare var suiteSetup: SuiteSetup;
declare var suiteTeardown;
declare var before: Before
declare var after: After;
declare var beforeEach: BeforeEach;
declare var afterEach: AfterEach;

declare module "mocha" {
  declare export var mocha: $npm$mocha$TestDefinition;
  declare export var describe: $npm$mocha$ContextDefinition;
  declare export var xdescribe: $npm$mocha$ContextDefinition;
  declare export var context: $npm$mocha$ContextDefinition;
  declare export var suite: $npm$mocha$ContextDefinition;
  declare export var it: $npm$mocha$TestDefinition;
  declare export var xit: $npm$mocha$TestDefinition;
  declare export var test: $npm$mocha$TestDefinition;
  declare export var specify: $npm$mocha$TestDefinition;

  declare export var run: Run;

  declare export var setup: Setup;
  declare export var teardown: Teardown;
  declare export var suiteSetup: SuiteSetup;
  declare export var suiteTeardown: SuiteTeardown;
  declare export var before: Before;
  declare export var after: After;
  declare export var beforeEach: BeforeEach;
  declare export var afterEach: AfterEach;

  declare export default $npm$mocha$Mocha;
}
