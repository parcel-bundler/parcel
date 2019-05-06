// @flow
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
import type {ServerOptions} from '@parcel/types';

export type Request = HTTPIncomingMessage | HTTPSIncomingMessage;
export type Response = HTTPServerResponse | HTTPSServerResponse;
export type Server = HTTPServer | HTTPSServer;

// TODO: Figure out if there is a node.js type that could be imported with a complete ServerError
export type ServerError = Error & {|
  code: string
|};

export type HMRServerOptions = {|
  ...ServerOptions,
  cacheDir: string
|};
