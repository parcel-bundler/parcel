// @flow strict-local

import type {SourceLocation} from '@parcel/types';
import type {
  EntryFileNode,
  NodeInput,
  EntryListInput,
  QueryContext,
} from '../types';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import {
  Node,
  getBundleGraphNode,
  getContentGraphForNode,
  registerNodeType,
} from './Node';

export const typeDefs: string = `#graphql
  type Entry implements Node {
    id: ID!
    contentKey: ID!
    type: String!
    nodesConnectedTo: [Node!]!
    nodesConnectedFrom: [Node!]!

    specifier: String!
    filePath: String!
    packagePath: String!
    target: String
    location: SourceLocation
  }

  input EntryListInput {
    ids: [ID!]
    contentKeys: [ID!]
    specifiers: [String!]
  }

  type Query {
    entry(id: ID!): Entry!
    allEntries(args: EntryListInput): [Entry!]!
  }
`;

export const resolvers = {
  Entry: {
    __isTypeOf: (node: Node): boolean => node.type() === 'entry_file',
  },
  Query: {
    entry: (_: mixed, args: NodeInput, context: QueryContext): Entry => {
      let node = getBundleGraphNode(args, context);
      invariant(node, `No entry with id or content key ${String(args.id)}`);
      invariant(
        node.type === 'entry_file',
        `Expected an entry_file but found ${node.type}`,
      );
      return new Entry(node);
    },

    allEntries: (
      _: mixed,
      __: EntryListInput,
      context: QueryContext,
    ): Entry[] => {
      let entryFiles = [];
      for (let node of context.bundleGraph.nodes.values()) {
        if (node.type === 'entry_file') {
          entryFiles.push(new Entry(node));
        }
      }
      return entryFiles;
    },
  },
};

export class Entry extends Node {
  #node: EntryFileNode;

  constructor(node: EntryFileNode) {
    super(node);
    this.#node = node;
  }

  filePath(): string {
    return String(this.#node.value.filePath);
  }

  packagePath(): string {
    return String(this.#node.value.packagePath);
  }

  target(): ?string {
    return this.#node.value.target;
  }

  location(): ?SourceLocation {
    return this.#node.value.loc;
  }

  specifier(_: mixed, context: QueryContext): string {
    let graph = getContentGraphForNode(this.#node, context);
    let node;
    for (let nodeId of graph.getNodeIdsConnectedTo(this.id(_, context))) {
      node = nullthrows(graph.getNode(nodeId));
      if (node.type === 'entry_specifier') {
        break;
      }
    }
    return String(nullthrows(node).value);
  }
}

registerNodeType('entry_file', Entry);
