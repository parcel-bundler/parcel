import * as ns from './middle.js';
// export * does NOT re-export `default`
output = { hasDefault: 'default' in ns, named: ns.named };
