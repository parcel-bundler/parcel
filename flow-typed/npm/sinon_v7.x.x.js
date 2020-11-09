// flow-typed signature: 81a0b737757fea4a808755db2c005acf
// flow-typed version: 8b3ac10de0/sinon_v7.x.x/flow_>=v0.80.x

declare module 'sinon' {
  declare interface SinonFakeCallApi {
    thisValue: any;
    args: Array<any>;
    exception: any;
    returnValue: any;
    calledOn(obj: any): boolean;
    calledWith(...args: Array<any>): boolean;
    calledWithExactly(...args: Array<any>): boolean;
    calledWithMatch(...args: Array<any>): boolean;
    notCalledWith(...args: Array<any>): boolean;
    notCalledWithMatch(...args: Array<any>): boolean;
    returned(value: any): boolean;
    threw(): boolean;
    threw(type: string): boolean;
    threw(obj: any): boolean;
  }

  declare interface SinonFake extends SinonFakeCallApi {
    (...args: Array<any>): any;
    callCount: number;
    called: boolean;
    notCalled: boolean;
    calledOnce: boolean;
    calledTwice: boolean;
    calledThrice: boolean;
    firstCall: SinonSpyCall;
    secondCall: SinonSpyCall;
    thirdCall: SinonSpyCall;
    lastCall: SinonSpyCall;
    thisValues: Array<any>;
    args: Array<any>[];
    exceptions: Array<any>;
    returnValues: Array<any>;
    calledBefore(anotherSpy: SinonSpy): boolean;
    calledAfter(anotherSpy: SinonSpy): boolean;
    calledImmediatelyBefore(anotherSpy: SinonSpy): boolean;
    calledImmediatelyAfter(anotherSpy: SinonSpy): boolean;
    calledWithNew(): boolean;
    alwaysCalledOn(obj: any): boolean;
    alwaysCalledWith(...args: Array<any>): boolean;
    alwaysCalledWithExactly(...args: Array<any>): boolean;
    alwaysCalledWithMatch(...args: Array<any>): boolean;
    neverCalledWith(...args: Array<any>): boolean;
    neverCalledWithMatch(...args: Array<any>): boolean;
    alwaysThrew(): boolean;
    alwaysThrew(type: string): boolean;
    alwaysThrew(obj: any): boolean;
    alwaysReturned(): boolean;
    getCall(n: number): SinonSpyCall;
    getCalls(): Array<SinonSpyCall>;
    resetHistory(): void;
    printf(format: string, ...args: Array<any>): string;
    restore(): void;
  }

  declare interface SinonFakeStatic {
    (): SinonSpy;
    (func: any): SinonSpy;
    (obj: any, method: string): SinonSpy;
    returns(obj: any): SinonFake;
    throws(type?: string): SinonFake;
    throws(obj: any): SinonFake;
    resolves(value?: any): SinonFake;
    rejects(): SinonFake;
    rejects(errorType: string): SinonFake;
    rejects(value: any): SinonFake;
    yields(...args: Array<any>): SinonFake;
    yieldsAsync(...args: Array<any>): SinonFake;
  }

  declare interface SinonSpyCallApi extends SinonFakeCallApi {
    thisValue: any;
    args: Array<any>;
    exception: any;
    returnValue: any;
    calledOn(obj: any): boolean;
    calledWith(...args: Array<any>): boolean;
    calledWithExactly(...args: Array<any>): boolean;
    calledWithMatch(...args: Array<any>): boolean;
    notCalledWith(...args: Array<any>): boolean;
    notCalledWithMatch(...args: Array<any>): boolean;
    returned(value: any): boolean;
    threw(): boolean;
    threw(type: string): boolean;
    threw(obj: any): boolean;
    callArg(pos: number): void;
    callArgOn(pos: number, obj: any, ...args: Array<any>): void;
    callArgWith(pos: number, ...args: Array<any>): void;
    callArgOnWith(pos: number, obj: any, ...args: Array<any>): void;
    yield(...args: Array<any>): void;
    yieldOn(obj: any, ...args: Array<any>): void;
    yieldTo(property: string, ...args: Array<any>): void;
    yieldToOn(property: string, obj: any, ...args: Array<any>): void;
  }

  declare interface SinonSpyCall extends SinonSpyCallApi {
    calledBefore(call: SinonSpyCall): boolean;
    calledAfter(call: SinonSpyCall): boolean;
    calledWithNew(call: SinonSpyCall): boolean;
  }

  declare interface SinonSpy extends SinonSpyCallApi, SinonFake {
    // This blows everything up... idk why
    (...args: Array<any>): any;
    withArgs(...args: Array<any>): SinonSpy;
    invokeCallback(...args: Array<any>): void;
  }

  declare interface SinonSpyStatic {
    (): SinonSpy;
    (func: any): SinonSpy;
    (obj: any, method: string): SinonSpy;
  }

  declare interface SinonStub extends SinonSpy {
    (...args?: Array<any>): any;
    resetBehavior(): void;
    resetHistory(): void;
    usingPromise(promiseLibrary: any): SinonStub;
    returns(obj: any): SinonStub;
    returnsArg(index: number): SinonStub;
    returnsThis(): SinonStub;
    resolves(value?: any): SinonStub;
    throws(type?: string): SinonStub;
    throws(obj: any): SinonStub;
    throwsArg(index: number): SinonStub;
    throwsException(type?: string): SinonStub;
    throwsException(obj: any): SinonStub;
    rejects(): SinonStub;
    rejects(errorType: string): SinonStub;
    rejects(value: any): SinonStub;
    callsArg(index: number): SinonStub;
    callThrough(): SinonStub;
    callsArgOn(index: number, context: any): SinonStub;
    callsArgWith(index: number, ...args: Array<any>): SinonStub;
    callsArgOnWith(index: number, context: any, ...args: Array<any>): SinonStub;
    callsArgAsync(index: number): SinonStub;
    callsArgOnAsync(index: number, context: any): SinonStub;
    callsArgWithAsync(index: number, ...args: Array<any>): SinonStub;
    callsArgOnWithAsync(index: number, context: any, ...args: Array<any>): SinonStub;
    callsFake(func: (...args: Array<any>) => void): SinonStub;
    get(func: () => any): SinonStub;
    set(func: (v: any) => mixed): SinonStub;
    onCall(n: number): SinonStub;
    onFirstCall(): SinonStub;
    onSecondCall(): SinonStub;
    onThirdCall(): SinonStub;
    value(val: any): SinonStub;
    yields(...args: Array<any>): SinonStub;
    yieldsOn(context: any, ...args: Array<any>): SinonStub;
    yieldsRight(...args: any[]): SinonStub;
    yieldsTo(property: string, ...args: Array<any>): SinonStub;
    yieldsToOn(property: string, context: any, ...args: Array<any>): SinonStub;
    yieldsAsync(...args: Array<any>): SinonStub;
    yieldsOnAsync(context: any, ...args: Array<any>): SinonStub;
    yieldsToAsync(property: string, ...args: Array<any>): SinonStub;
    yieldsToOnAsync(property: string, context: any, ...args: Array<any>): SinonStub;
    withArgs(...args: Array<any>): SinonStub;
  }

  declare interface SinonStubStatic {
    (): SinonStub;
    (obj: any): SinonStub;
    (obj: any, method: string): SinonStub;
  }

  declare interface SinonExpectation extends SinonStub {
    atLeast(n: number): SinonExpectation;
    atMost(n: number): SinonExpectation;
    never(): SinonExpectation;
    once(): SinonExpectation;
    twice(): SinonExpectation;
    thrice(): SinonExpectation;
    exactly(n: number): SinonExpectation;
    withArgs(...args: Array<any>): SinonExpectation;
    withExactArgs(...args: Array<any>): SinonExpectation;
    on(obj: any): SinonExpectation;
    verify(): SinonExpectation;
    restore(): void;
  }

  declare interface SinonExpectationStatic {
    create(methodName?: string): SinonExpectation;
  }

  declare interface SinonMock {
    expects(method: string): SinonExpectation;
    restore(): void;
    verify(): void;
  }

  declare interface SinonMockStatic {
    (obj: any): SinonMock;
    (): SinonExpectation;
  }

  declare interface SinonFakeTimers {
    now: number;
    create(now: number): SinonFakeTimers;
    setTimeout(callback: (...args: Array<any>) => void, timeout: number, ...args: Array<any>): number;
    clearTimeout(id: number): void;
    setInterval(callback: (...args: Array<any>) => void, timeout: number, ...args: Array<any>): number;
    clearInterval(id: number): void;
    tick(ms: number): number;
    reset(): void;
    Date(): Date;
    Date(year: number): Date;
    Date(year: number, month: number): Date;
    Date(year: number, month: number, day: number): Date;
    Date(year: number, month: number, day: number, hour: number): Date;
    Date(year: number, month: number, day: number, hour: number, minute: number): Date;
    Date(year: number, month: number, day: number, hour: number, minute: number, second: number): Date;
    Date(year: number, month: number, day: number, hour: number, minute: number, second: number, ms: number): Date;
    restore(): void;

    /**
     * Simulate the user changing the system clock while your program is running. It changes the 'now' timestamp
     * without affecting timers, intervals or immediates.
     * @param now The new 'now' in unix milliseconds
     */
    setSystemTime(now: number): void;

    /**
     * Simulate the user changing the system clock while your program is running. It changes the 'now' timestamp
     * without affecting timers, intervals or immediates.
     * @param now The new 'now' as a JavaScript Date
     */
    setSystemTime(date: Date): void;
  }

  declare interface SinonFakeTimersStatic {
    (): SinonFakeTimers;
    (config: SinonFakeTimersConfig): SinonFakeTimers;
    (now: number): SinonFakeTimers;
  }

  declare interface SinonFakeTimersConfig {
    now: number | Date;
    toFake: string[];
    shouldAdvanceTime: boolean;

  }

  declare interface SinonFakeUploadProgress {
    eventListeners: {
      progress: Array<any>;
      load: Array<any>;
      abort: Array<any>;
      error: Array<any>;
    };

    addEventListener(event: string, listener: (e: Event) => any): void;
    removeEventListener(event: string, listener: (e: Event) => any): void;
    dispatchEvent(event: Event): void;
  }

  declare interface SinonFakeXMLHttpRequest {
    onCreate: (xhr: SinonFakeXMLHttpRequest) => void;
    url: string;
    method: string;
    requestHeaders: any;
    requestBody: string;
    status: number;
    statusText: string;
    async: boolean;
    username: string;
    password: string;
    withCredentials: boolean;
    upload: SinonFakeUploadProgress;
    responseXML: Document;
    getResponseHeader(header: string): string;
    getAllResponseHeaders(): any;
    restore(): void;
    useFilters: boolean;
    addFilter(filter: (method: string, url: string, async: boolean, username: string, password: string) => boolean): void;
    setResponseHeaders(headers: any): void;
    setResponseBody(body: string): void;
    respond(status: number, headers: any, body: string): void;
    autoRespond(ms: number): void;
    error(): void;
    onerror(): void;
  }

  declare type SinonFakeXMLHttpRequestStatic = () => SinonFakeXMLHttpRequest;

  declare interface SinonFakeServerConfig {
    autoRespond?: boolean;
    autoRespondAfter?: number;
    respondImmediately?: boolean;
    fakeHTTPMethods?: boolean;
  }

  declare interface SinonFakeServer {
    autoRespond: boolean;
    autoRespondAfter: number;
    configure(config: SinonFakeServerConfig): void;
    fakeHTTPMethods: boolean;
    getHTTPMethod: (request: SinonFakeXMLHttpRequest) => string;
    requests: SinonFakeXMLHttpRequest[];
    respondImmediately: boolean;
    respondWith(body: string): void;
    respondWith(response: Array<any>): void;
    respondWith(fn: (xhr: SinonFakeXMLHttpRequest) => void): void;
    respondWith(url: string, body: string): void;
    respondWith(url: string, response: Array<any>): void;
    respondWith(url: string, fn: (xhr: SinonFakeXMLHttpRequest) => void): void;
    respondWith(method: string, url: string, body: string): void;
    respondWith(method: string, url: string, response: Array<any>): void;
    respondWith(method: string, url: string, fn: (xhr: SinonFakeXMLHttpRequest) => void): void;
    respondWith(url: RegExp, body: string): void;
    respondWith(url: RegExp, response: Array<any>): void;
    respondWith(url: RegExp, fn: (xhr: SinonFakeXMLHttpRequest) => void): void;
    respondWith(method: string, url: RegExp, body: string): void;
    respondWith(method: string, url: RegExp, response: Array<any>): void;
    respondWith(method: string, url: RegExp, fn: (xhr: SinonFakeXMLHttpRequest) => void): void;
    respond(): void;
    restore(): void;
  }

  declare interface SinonFakeServerStatic {
    create(): SinonFakeServer;
  }

  declare interface SinonExposeOptions {
    prefix?: string;
    includeFail?: boolean;
  }

  declare interface SinonAssert {
    failException: string;
    fail: (message?: string) => void;
    pass: (assertion: any) => void;
    notCalled(spy: SinonSpy): void;
    called(spy: SinonSpy): void;
    calledOnce(spy: SinonSpy): void;
    calledTwice(spy: SinonSpy): void;
    calledThrice(spy: SinonSpy): void;
    callCount(spy: SinonSpy, count: number): void;
    callOrder(...spies: SinonSpy[]): void;
    calledOn(spy: SinonSpy, obj: any): void;
    alwaysCalledOn(spy: SinonSpy, obj: any): void;
    calledWith(spy: SinonSpy, ...args: Array<any>): void;
    alwaysCalledWith(spy: SinonSpy, ...args: Array<any>): void;
    neverCalledWith(spy: SinonSpy, ...args: Array<any>): void;
    calledWithExactly(spy: SinonSpy, ...args: Array<any>): void;
    alwaysCalledWithExactly(spy: SinonSpy, ...args: Array<any>): void;
    calledWithMatch(spy: SinonSpy, ...args: Array<any>): void;
    alwaysCalledWithMatch(spy: SinonSpy, ...args: Array<any>): void;
    neverCalledWithMatch(spy: SinonSpy, ...args: Array<any>): void;
    threw(spy: SinonSpy): void;
    threw(spy: SinonSpy, exception: string): void;
    threw(spy: SinonSpy, exception: any): void;
    alwaysThrew(spy: SinonSpy): void;
    alwaysThrew(spy: SinonSpy, exception: string): void;
    alwaysThrew(spy: SinonSpy, exception: any): void;
    expose(obj: any, options?: SinonExposeOptions): void;
  }

  declare interface SinonMatcher {
    and(expr: SinonMatcher): SinonMatcher;
    or(expr: SinonMatcher): SinonMatcher;
  }

  declare interface SinonArrayMatcher extends SinonMatcher {
    /**
     * Requires an Array to be deep equal another one.
     */
    deepEquals(expected: Array<any>): SinonMatcher;
    /**
     * Requires an Array to start with the same values as another one.
     */
    startsWith(expected: Array<any>): SinonMatcher;
    /**
     * Requires an Array to end with the same values as another one.
     */
    endsWith(expected: Array<any>): SinonMatcher;
    /**
     * Requires an Array to contain each one of the values the given array has.
     */
    contains(expected: Array<any>): SinonMatcher;
  }

  declare interface SinonMapMatcher extends SinonMatcher {
    /**
     * Requires a Map to be deep equal another one.
     */
    deepEquals(expected: Map<any, any>): SinonMatcher;
    /**
     * Requires a Map to contain each one of the items the given map has.
     */
    contains(expected: Map<any, any>): SinonMatcher;
  }

  declare interface SinonSetMatcher extends SinonMatcher {
    /**
     *  Requires a Set to be deep equal another one.
     */
    deepEquals(expected: Set<any>): SinonMatcher;
    /**
     * Requires a Set to contain each one of the items the given set has.
     */
    contains(expected: Set<any>): SinonMatcher;
  }

  declare interface SinonMatch {
    (value: number): SinonMatcher;
    (value: string): SinonMatcher;
    (expr: RegExp): SinonMatcher;
    (obj: any): SinonMatcher;
    (callback: (value: any) => boolean): SinonMatcher;
    any: SinonMatcher;
    defined: SinonMatcher;
    truthy: SinonMatcher;
    falsy: SinonMatcher;
    bool: SinonMatcher;
    number: SinonMatcher;
    string: SinonMatcher;
    object: SinonMatcher;
    func: SinonMatcher;
    /**
     * Requires the value to be a Map.
     */
    map: SinonMapMatcher;
    /**
     * Requires the value to be a Set.
     */
    set: SinonSetMatcher;
    /**
     * Requires the value to be an Array.
     */
    array: SinonArrayMatcher;
    regexp: SinonMatcher;
    date: SinonMatcher;
    symbol: SinonMatcher;
    same(obj: any): SinonMatcher;
    typeOf(type: string): SinonMatcher;
    instanceOf(type: any): SinonMatcher;
    has(property: string, expect?: any): SinonMatcher;
    hasOwn(property: string, expect?: any): SinonMatcher;
  }

  declare interface SinonSandboxConfig {
    injectInto?: any;
    properties?: string[];
    useFakeTimers?: SinonFakeTimersConfig;
    useFakeServer?: any;
  }

  declare interface SinonSandbox {
    assert: SinonAssert;
    clock: SinonFakeTimers;
    requests: SinonFakeXMLHttpRequest;
    server: SinonFakeServer;
    spy: SinonSpyStatic;
    stub: SinonStubStatic;
    mock: SinonMockStatic;
    useFakeTimers: SinonFakeTimersStatic;
    useFakeXMLHttpRequest: SinonFakeXMLHttpRequestStatic;
    useFakeServer(): SinonFakeServer;
    restore(): void;
    reset(): void;
    resetHistory(): void;
    resetBehavior(): void;
    usingPromise(promiseLibrary: any): SinonSandbox;
    verify(): void;
    verifyAndRestore(): void;
  }

  declare interface SinonSandboxStatic {
    create(): SinonSandbox;
    create(config: SinonSandboxConfig): SinonSandbox;
  }

  declare interface SinonXMLHttpRequestStatic {
    XMLHttpRequest: XMLHttpRequest;
  }

  declare module.exports: {
    createFakeServer(config?: SinonFakeServerConfig): SinonFakeServer;
    createFakeServerWithClock(): SinonFakeServer;
    createSandbox(config?: SinonSandboxConfig): SinonSandbox;
    defaultConfig: SinonSandboxConfig;
    spy: SinonSpyStatic;
    stub: SinonStubStatic;
    expectation: SinonExpectationStatic;
    mock: SinonMockStatic;
    useFakeTimers: SinonFakeTimersStatic;
    clock: SinonFakeTimers;
    useFakeXMLHttpRequest: SinonFakeXMLHttpRequestStatic;
    FakeXMLHttpRequest: SinonFakeXMLHttpRequest;
    fakeServer: SinonFakeServerStatic;
    fakeServerWithClock: SinonFakeServerStatic;
    assert: SinonAssert;
    match: SinonMatch;
    sandbox: SinonSandboxStatic;
    createStubInstance<T>(constructor: any): any;
    format(obj: any): string;
    setFormatter(aCustomFormatter: (obj: any) => string): void;
    restore(object: any): void;
    fake: SinonFakeStatic;
    xhr: SinonXMLHttpRequestStatic;
    spyCall(spy: any,
      thisValue: any,
      args: Array<any>,
      returnValue: any,
      exception: any,
      id: number,
      errorWithCallStack: any): SinonSpyCall;
  };
}
