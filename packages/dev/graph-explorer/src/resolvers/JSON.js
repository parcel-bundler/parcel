// @flow strict-local

// $FlowFixMe[untyped-import]
import GraphQLJSON, {GraphQLJSONObject} from 'graphql-type-json';

export const typeDefs = `#graphql
  scalar JSON
  scalar JSONObject
`;

export const resolvers = {
  JSON: GraphQLJSON,
  JSONObject: GraphQLJSONObject,
};
