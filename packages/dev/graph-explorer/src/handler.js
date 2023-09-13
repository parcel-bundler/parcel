// @flow strict-local

import type {GraphContext} from './types';
import type {PluginLogger} from '@parcel/types';
import type {NextFunction, $Request, $Response} from 'express';

// $FlowFixMe[untyped-import]
import {mergeTypeDefs, mergeResolvers} from '@graphql-tools/merge';
// $FlowFixMe[untyped-import]
import {makeExecutableSchema} from '@graphql-tools/schema';
// $FlowFixMe[untyped-import]
import {createYoga} from 'graphql-yoga';

// $FlowFixMe[unclear-type]
export function createSchema(): any {
  // Using require here to make resolvers hot-reloadable.
  let {resolvers, typeDefs} = require('./resolvers');

  return makeExecutableSchema({
    typeDefs: mergeTypeDefs(typeDefs),
    resolvers: mergeResolvers(resolvers),
  });
}

export function createHandler(
  context: GraphContext,
  logger?: ?PluginLogger,
): (req: $Request, res: $Response, next: NextFunction) => mixed {
  let schema = createSchema();

  let logging;
  if (logger) {
    logging = {
      debug(...args) {
        logger.verbose({message: args.join(' ')});
      },
      info(...args) {
        logger.info({message: args.join(' ')});
      },
      warn(...args) {
        logger.warn({message: args.join(' ')});
      },
      error(...args) {
        logger.error({message: args.join(' ')});
      },
    };
  }

  return createYoga({schema, context, logging});
}
