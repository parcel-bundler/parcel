// flow-typed signature: 5c17cfda258a9db73cd2282d14ff18d0
// flow-typed version: 2f514ea8dd/express_v4.x.x/flow_>=v0.104.x

declare type express$RouterOptions = {
  caseSensitive?: boolean,
  mergeParams?: boolean,
  strict?: boolean,
  ...
};

declare class express$RequestResponseBase {
  app: express$Application<any, any>;
  get(field: string): string | void;
}

declare type express$RequestParams = { [param: string]: string, ... }

/*
  NOTE: Use caution when extending `express$Request` or `express$Response`. When
  a request first hits the server, its `req` and `res` will not have any
  additional properties, even if you explicitly type them with your custom
  subclass. Subsequent middleware may assign these properties, but you must be
  cognizant of this ordering. One way to handle this is marking all properties
  as optional to force refinement every time a property is accessed. Therefore,
  we advise that you always mark properties as _optional_ in `express$Request`
  and `express$Response` subclasses.

  You may decide not to do this, in which case the typings will be unsound and
  the behavior will be similar to how arrays work in Flow. See here for more
  information: https://flow.org/en/docs/types/arrays/#toc-array-access-is-unsafe

  See #3578 and #3337 for additional discussion. If you have ideas on how to
  improve these typings, please share them in #3578 or open a new issue.

  **BAD**
  declare class test_express$CustomRequest extends express$Request {
    foo: string;
  }

  **GOOD**
  declare class test_express$CustomRequest extends express$Request {
    foo: string | void;
  }
*/
declare class express$Request extends http$IncomingMessage mixins express$RequestResponseBase {
  baseUrl: string;
  body: mixed;
  cookies: { [cookie: string]: string, ... };
  connection: net$Socket;
  fresh: boolean;
  hostname: string;
  ip: string;
  ips: Array<string>;
  method: string;
  originalUrl: string;
  params: express$RequestParams;
  path: string;
  protocol: 'https' | 'http';
  query: { [name: string]: string | Array<string>, ... };
  route: string;
  secure: boolean;
  signedCookies: { [signedCookie: string]: string, ... };
  stale: boolean;
  subdomains: Array<string>;
  xhr: boolean;
  accepts(types: string): string | false;
  accepts(types: Array<string>): string | false;
  acceptsCharsets(...charsets: Array<string>): string | false;
  acceptsEncodings(...encoding: Array<string>): string | false;
  acceptsLanguages(...lang: Array<string>): string | false;
  header(field: string): string | void;
  is(type: string): string | false;
  param(name: string, defaultValue?: string): string | void;
}

declare type express$CookieOptions = {
  domain?: string,
  encode?: (value: string) => string,
  expires?: Date,
  httpOnly?: boolean,
  maxAge?: number,
  path?: string,
  secure?: boolean,
  signed?: boolean,
  ...
};

declare type express$Path = string | RegExp;

declare type express$RenderCallback = (err: Error | null, html?: string) => mixed;

declare type express$SendFileOptions = {
  maxAge?: number,
  root?: string,
  lastModified?: boolean,
  headers?: { [name: string]: string, ... },
  dotfiles?: 'allow' | 'deny' | 'ignore',
  ...
};

declare class express$Response extends http$ServerResponse mixins express$RequestResponseBase {
  headersSent: boolean;
  locals: { [name: string]: mixed, ... };
  append(field: string, value?: string): this;
  attachment(filename?: string): this;
  cookie(name: string, value: string, options?: express$CookieOptions): this;
  clearCookie(name: string, options?: express$CookieOptions): this;
  download(path: string, filename?: string, callback?: (err?: ?Error) => void): this;
  format(typesObject: { [type: string]: Function, ... }): this;
  json(body?: mixed): this;
  jsonp(body?: mixed): this;
  links(links: { [name: string]: string, ... }): this;
  location(path: string): this;
  redirect(url: string, ...args: Array<void>): this;
  redirect(status: number, url: string, ...args: Array<void>): this;
  render(view: string, locals?: { [name: string]: mixed, ... }, callback?: express$RenderCallback): this;
  send(body?: mixed): this;
  sendFile(path: string, options?: express$SendFileOptions, callback?: (err?: ?Error) => mixed): this;
  sendStatus(statusCode: number): this;
  header(field: string, value?: string): this;
  header(headers: { [name: string]: string, ... }): this;
  set(field: string, value?: string|string[]): this;
  set(headers: { [name: string]: string, ... }): this;
  status(statusCode: number): this;
  type(type: string): this;
  vary(field: string): this;
  req: express$Request;
}

declare type express$NextFunction = (err?: ?Error | 'route') => mixed;
declare type express$Middleware<
  Req: express$Request = express$Request,
  Res: express$Response = express$Response,
> =
  ((req: Req, res: Res, next: express$NextFunction) => mixed) |
  ((error: Error, req: Req, res: Res, next: express$NextFunction) => mixed);

declare interface express$RouteMethodType<
  T,
  Req: express$Request = express$Request,
  Res: express$Response = express$Response,
> {
  (middleware: express$Middleware<Req, Res>): T;
  (...middleware: Array<express$Middleware<Req, Res>>): T;
  (
    path: express$Path | $ReadOnlyArray<express$Path>,
    ...middleware: Array<express$Middleware<Req, Res>>
  ): T;
}

declare class express$Route<
  Req: express$Request = express$Request,
  Res: express$Response = express$Response,
> {
  all: express$RouteMethodType<this, Req, Res>;
  get: express$RouteMethodType<this, Req, Res>;
  post: express$RouteMethodType<this, Req, Res>;
  put: express$RouteMethodType<this, Req, Res>;
  head: express$RouteMethodType<this, Req, Res>;
  delete: express$RouteMethodType<this, Req, Res>;
  options: express$RouteMethodType<this, Req, Res>;
  trace: express$RouteMethodType<this, Req, Res>;
  copy: express$RouteMethodType<this, Req, Res>;
  lock: express$RouteMethodType<this, Req, Res>;
  mkcol: express$RouteMethodType<this, Req, Res>;
  move: express$RouteMethodType<this, Req, Res>;
  purge: express$RouteMethodType<this, Req, Res>;
  propfind: express$RouteMethodType<this, Req, Res>;
  proppatch: express$RouteMethodType<this, Req, Res>;
  unlock: express$RouteMethodType<this, Req, Res>;
  report: express$RouteMethodType<this, Req, Res>;
  mkactivity: express$RouteMethodType<this, Req, Res>;
  checkout: express$RouteMethodType<this, Req, Res>;
  merge: express$RouteMethodType<this, Req, Res>;

  // @TODO Missing 'm-search' but get flow illegal name error.

  notify: express$RouteMethodType<this, Req, Res>;
  subscribe: express$RouteMethodType<this, Req, Res>;
  unsubscribe: express$RouteMethodType<this, Req, Res>;
  patch: express$RouteMethodType<this, Req, Res>;
  search: express$RouteMethodType<this, Req, Res>;
  connect: express$RouteMethodType<this, Req, Res>;
}

declare class express$Router<
  Req: express$Request = express$Request,
  Res: express$Response = express$Response,
> extends express$Route<Req, Res> {
  constructor(options?: express$RouterOptions): void;
  route(path: string): express$Route<Req, Res>;
  static <Req2: express$Request, Res2: express$Response>(
    options?: express$RouterOptions,
  ): express$Router<Req2, Res2>;
  use(middleware: express$Middleware<Req, Res>): this;
  use(...middleware: Array<express$Middleware<Req, Res>>): this;
  use(
    path: express$Path | $ReadOnlyArray<express$Path>,
    ...middleware: Array<express$Middleware<Req, Res>>
  ): this;
  use(path: string, router: express$Router<Req, Res>): this;
  handle(req: http$IncomingMessage<>, res: http$ServerResponse, next: express$NextFunction): void;
  param(
    param: string,
    callback: (
      req: Req,
      res: Res,
      next: express$NextFunction,
      value: string,
      paramName: string,
    ) => mixed
  ): void;
  (req: http$IncomingMessage<>, res: http$ServerResponse, next?: ?express$NextFunction): void;
}

declare class express$Application<
  Req: express$Request = express$Request,
  Res: express$Response = express$Response,
> extends express$Router<Req, Res> mixins events$EventEmitter {
  constructor(): void;
  locals: { [name: string]: mixed, ... };
  mountpath: string;
  listen(port: number, hostname?: string, backlog?: number, callback?: (err?: ?Error) => mixed): ?http$Server;
  listen(port: number, hostname?: string, callback?: (err?: ?Error) => mixed): ?http$Server;
  listen(port: number, callback?: (err?: ?Error) => mixed): ?http$Server;
  listen(path: string, callback?: (err?: ?Error) => mixed): ?http$Server;
  listen(handle: Object, callback?: (err?: ?Error) => mixed): ?http$Server;
  disable(name: string): void;
  disabled(name: string): boolean;
  enable(name: string): this;
  enabled(name: string): boolean;
  engine(name: string, callback: Function): void;
  /**
   * Mixed will not be taken as a value option. Issue around using the GET http method name and the get for settings.
   */
  //   get(name: string): mixed;
  set(name: string, value: mixed): mixed;
  render(name: string, optionsOrFunction: { [name: string]: mixed, ... }, callback: express$RenderCallback): void;
  handle(req: http$IncomingMessage<>, res: http$ServerResponse, next?: ?express$NextFunction): void;
  // callable signature is not inherited
  (req: http$IncomingMessage<>, res: http$ServerResponse, next?: ?express$NextFunction): void;
}

declare module 'express' {
  declare export type RouterOptions = express$RouterOptions;
  declare export type CookieOptions = express$CookieOptions;
  declare export type Middleware<
    Req: express$Request = express$Request,
    Res: express$Response = express$Response,
  > = express$Middleware<Req, Res>;
  declare export type NextFunction = express$NextFunction;
  declare export type RequestParams = express$RequestParams;
  declare export type $Response = express$Response;
  declare export type $Request = express$Request;
  declare export type $Application<
    Req: express$Request = express$Request,
    Res: express$Response = express$Response,
  > = express$Application<Req, Res>;

  declare module.exports: {
    // If you try to call like a function, it will use this signature
    <Req: express$Request, Res: express$Response>(): express$Application<Req, Res>,
    // `static` property on the function
    static: <Req: express$Request, Res: express$Response>(root: string, options?: Object) => express$Middleware<Req, Res>,
    // `Router` property on the function
    Router: typeof express$Router,
    ...
  };
}
