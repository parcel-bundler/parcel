// @flow
import type {ServerOptions} from '@parcel/types';
import {
  IncomingMessage as HTTPIncomingMessage,
  ServerResponse as HTTPServerResponse,
  Server as HTTPServer
} from 'http';
import {
  IncomingMessage as HTTPSIncomingMessage,
  ServerResponse as HTTPSServerResponse,
  Server as HTTPSServer
} from 'https';

export type Request = HTTPIncomingMessage | HTTPSIncomingMessage;
export type Response = HTTPServerResponse | HTTPSServerResponse;
export type Server = HTTPServer | HTTPSServer;
export type DevServerOptions = {|
  ...ServerOptions,
  distDir: string,
  publicUrl: string,
  cacheDir: string
|};
