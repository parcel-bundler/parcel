// @flow strict-local

import type {ResolverMap} from '../types';

const fs = require('fs');
const path = require('path');

const Asset = require('./Asset');
const Bundle = require('./Bundle');
const BundleGroup = require('./BundleGroup');
const Dependency = require('./Dependency');
const Entry = require('./Entry');
const Root = require('./Root');

const JSON = require('./JSON');
const Node = require('./Node');

const typeDefs: string[] = [
  JSON.typeDefs,
  Node.typeDefs,
  Asset.typeDefs,
  Bundle.typeDefs,
  BundleGroup.typeDefs,
  Dependency.typeDefs,
  Entry.typeDefs,
  Root.typeDefs,
];

// Automatically load *.graphql from this directory.
for (let filename of fs.readdirSync(__dirname)) {
  if (filename.endsWith('.graphql')) {
    typeDefs.push(fs.readFileSync(path.join(__dirname, filename), 'utf8'));
  }
}

const resolvers: ResolverMap[] = [
  JSON.resolvers,
  Node.resolvers,
  Asset.resolvers,
  Bundle.resolvers,
  BundleGroup.resolvers,
  Dependency.resolvers,
  Entry.resolvers,
  Root.resolvers,
];

module.exports = {typeDefs, resolvers};
