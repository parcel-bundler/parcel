// @flow strict-local
const invariant = require('assert');
const nullthrows = require('nullthrows');
const t = require('@babel/types');
const template = require('@babel/template');
const {default: generate} = require('@babel/generator');
// $FlowFixMe
const {nanoid} = require('nanoid');

/*::
import type {Template} from '@babel/template';
import type {
  Identifier,
  Expression,
  StringLiteral,
  Statement,
} from '@babel/types';

type Templates = {|
  IMPORT_NAMED: Template<
    {|local: Identifier, name: Identifier, source: StringLiteral|},
    Statement,
  >,
  IMPORT_NAMESPACE: Template<
    {|local: Identifier, source: StringLiteral|},
    Statement,
  >,
  EXPORT_CONST: Template<{|name: Identifier, value: Expression|}, Statement>,
  EXPORT_NAMED: Template<{|local: Identifier, name: Identifier|}, Statement>,
  CONST: Template<{|name: Identifier, value: Expression|}, Statement>,
  REEXPORT_NAMED: Template<
    {|local: Identifier, name: Identifier, source: StringLiteral|},
    Statement,
  >,
  REEXPORT_NAMESPACE: Template<{|source: StringLiteral|}, Statement>,
  REEXPORT_NAMESPACE_AS: Template<
    {|name: Identifier, source: StringLiteral|},
    Statement,
  >,
|};

type ModuleImportSymbol = {|
  from: number,
  symbol: string,
  as: string,
|};
type ModuleExportSymbol = {|
  from?: ?number,
  symbol: string,
  as: string,
|};

type Module = {|
  type: 'mjs', // | 'cjs',
  imported: Array<ModuleImportSymbol>,
  exported: Array<ModuleExportSymbol>,
|};

type State = {|
  modules: {|
    [number]: Module,
  |},
  entries: Array<number>,
  noSideEffects: Array<number>
|};

type Fixture = {|
  files: {|[string]: string|},
  entries: Array<string>,
|};
*/

const TEMPLATES /*: {|mjs: Templates|}*/ = {
  mjs: {
    IMPORT_NAMED: template.statement(`
  import { %%name%% as %%local%% } from %%source%%;
`),
    IMPORT_NAMESPACE: template.statement(`
  import * as %%local%% from %%source%%;
`),
    EXPORT_CONST: template.statement(`
  export const %%name%% = %%value%%;
`),
    EXPORT_NAMED: template.statement(`
  export { %%local%% as %%name%% };
`),
    CONST: template.statement(`
  const %%name%% = %%value%%;
`),
    REEXPORT_NAMED: template.statement(`
  export { %%local%% as %%name%% } from %%source%%;
`),
    REEXPORT_NAMESPACE: template.statement(`
  export * from %%source%%;
`),
    REEXPORT_NAMESPACE_AS: template.statement(`
  export * as %%name%% from %%source%%;
`),
  },
  //   cjs: {
  //     EXPORT_CONST: template.statement(`
  //   module.exports.%%name%% = %%value%%;
  // `),
  //     EXPORT_NAMED: template.statement(`
  //   module.exports.%%name%% = %%local%%;
  // `),
  //     CONST: template.statement(`
  //   const %%name%% = %%value%%;
  // `),
  //     EXPORT_NAMED_FROM: template.statement(`
  //   module.exports.%%name%% = require(%%source%%).%%local%%;
  // `),
  //   },
};

function getRandom(max) {
  return Math.floor(Math.random() * max);
}

function getRandomModuleIndex(state) {
  return getRandom(Object.keys(state.modules).length);
}

function appendToModule(
  state /*: State*/,
  n /*: number*/,
  data /*: $Shape<Module> */,
) {
  let {imported = [], exported = []} = data;

  let mod = state.modules[n];
  return {
    ...state,
    modules: {
      ...state.modules,
      [n]: {
        ...mod,
        imported: [...mod.imported, ...imported],
        exported: [...mod.exported, ...exported],
      },
    },
  };
}

let getNewExportNameNext = 'a';
function getNewExportName() /*: string*/ {
  for (let i = getNewExportNameNext.length - 1; i >= 0; i--) {
    if (getNewExportNameNext[i] !== 'z') {
      getNewExportNameNext =
        getNewExportNameNext.substring(0, i) +
        String.fromCharCode(getNewExportNameNext.charCodeAt(i) + 1) +
        getNewExportNameNext.substring(i + 1, getNewExportNameNext.length);
      break;
    }
    if (i === 0) {
      getNewExportNameNext = 'a'.repeat(getNewExportNameNext.length + 1);
    }
  }
  if (
    getNewExportNameNext === 'as' ||
    !t.isValidIdentifier(getNewExportNameNext)
  ) {
    return getNewExportName();
  }
  return getNewExportNameNext;
}

function getNewModuleIndex(state /*: State*/) /*: number*/ {
  return Object.keys(state.modules).length;
}

const ACTIONS /*: Array<[number, (State) => State]> */ = [
  [
    0.2,
    function addUnusedNamedExport(oldState) {
      return appendToModule(oldState, getRandomModuleIndex(oldState), {
        exported: [
          {
            symbol: getNewExportName(),
            as: getNewExportName(),
          },
        ],
      });
    },
  ],
  [
    0.25,
    function addNamedExport(oldState) {
      let n = getRandomModuleIndex(oldState);
      let as = getNewExportName();
      let state = appendToModule(oldState, n, {
        exported: [
          {
            symbol: getNewExportName(),
            as,
          },
        ],
      });

      for (let i = getRandomModuleIndex(state) + 1; i >= 0; i--) {
        state = appendToModule(state, getRandomModuleIndex(state), {
          imported: [
            {
              from: n,
              symbol: as,
              as: getNewExportName(),
            },
          ],
        });
      }
      return state;
    },
  ],
  [
    0.3,
    function moveLocalExportToNewDependency(state) {
      let nOld = getRandomModuleIndex(state);
      let modOld = state.modules[nOld];
      if (modOld.exported.length === 0) {
        return state;
      }

      let oldExportIndex = getRandom(modOld.exported.length);
      let movedExport = modOld.exported[oldExportIndex];

      let nNew = getNewModuleIndex(state);
      return {
        ...state,
        modules: {
          ...state.modules,
          [nOld]: {
            ...modOld,
            exported: [
              ...modOld.exported.filter((_, i) => i != oldExportIndex),
              {
                symbol: movedExport.as,
                as: movedExport.as,
                from: nNew,
              },
            ],
          },
          [nNew]: {
            imported: [],
            exported: [movedExport],
            type: 'mjs',
          },
        },
      };
    },
  ],
  [
    0.2,
    function addNamespaceReexportToExisting(state) {
      let n1 = getRandomModuleIndex(state);
      let n2 = getRandomModuleIndex(state);
      if (n1 >= n2) return state;

      let as = Math.random() > 0.5 ? getNewExportName() : '*';

      return appendToModule(state, n1, {
        exported: [
          {
            from: n2,
            symbol: '*',
            as,
          },
        ],
      });
    },
  ],
  // [
  //   0.1,
  //   function addEntry(state) {
  //     let n = getNewModuleIndex(state);
  //     return {
  //       ...state,
  //       modules: {
  //         ...state.modules,
  //         [n]: {
  //           imported: [],
  //           exported: [],
  //           type: 'mjs',
  //         },
  //       },
  //       entries: [...state.entries, n],
  //     };
  //   },
  // ],
  [
    0.05,
    function makeSideEffectFree(state) {
      let n = getRandomModuleIndex(state);
      if (state.entries.includes(n)) {
        return state;
      }
      return {
        ...state,
        noSideEffects: [...state.noSideEffects, n],
      };
    },
  ],
];

invariant.deepEqual(
  ACTIONS.reduce((acc, [p]) => acc + p * 100, 0),
  100,
  'invalid weights for actions',
);

function mutate(state /*: State */) /*: State*/ {
  let action;

  if (process.env.ACTION != null) {
    action = ACTIONS[Number(process.env.ACTION)][1];
  } else {
    let random = Math.random();
    for (let [p, a] of ACTIONS) {
      if (random < p) {
        action = a;
        break;
      } else {
        random -= p;
      }
    }
    invariant(action);
  }

  return action(state);
}

function numberToFilename(n /*: number */, type /*: string*/) {
  return `${n}.${type}`;
}

function linearizeState(state /*: State */) /* : Fixture */ {
  // $FlowFixMe
  let modules /*: Array<[string, Module]> */ = Object.entries(state.modules);
  return {
    files: Object.fromEntries(
      modules
        .map(([n, {type, imported, exported}]) => {
          let importStatements = [];
          let otherStatements = [];
          let exportStatements = [];

          for (let s of imported) {
            if (s.symbol === '*') {
              importStatements.push(
                TEMPLATES[type].IMPORT_NAMESPACE({
                  local: t.identifier(s.as),
                  source: t.stringLiteral(
                    './' + numberToFilename(s.from, state.modules[s.from].type),
                  ),
                }),
              );
            } else {
              importStatements.push(
                TEMPLATES[type].IMPORT_NAMED({
                  name: t.identifier(s.symbol),
                  local: t.identifier(s.as),
                  source: t.stringLiteral(
                    './' + numberToFilename(s.from, state.modules[s.from].type),
                  ),
                }),
              );
            }
          }
          for (let s of exported) {
            if (s.from == null) {
              if (s.symbol === s.as) {
                exportStatements.push(
                  TEMPLATES[type].EXPORT_CONST({
                    name: t.identifier(s.symbol),
                    value: t.stringLiteral(nanoid(5)),
                  }),
                );
              } else {
                otherStatements.push(
                  TEMPLATES[type].CONST({
                    name: t.identifier(s.symbol),
                    value: t.stringLiteral(nanoid(5)),
                  }),
                );
                exportStatements.push(
                  TEMPLATES[type].EXPORT_NAMED({
                    local: t.identifier(s.symbol),
                    name: t.identifier(s.as),
                  }),
                );
              }
            } else {
              let from = nullthrows(s.from);
              if (s.symbol === '*') {
                if (s.as === '*') {
                  exportStatements.push(
                    TEMPLATES[type].REEXPORT_NAMESPACE({
                      source: t.stringLiteral(
                        './' + numberToFilename(from, state.modules[from].type),
                      ),
                    }),
                  );
                } else {
                  exportStatements.push(
                    TEMPLATES[type].REEXPORT_NAMESPACE_AS({
                      name: t.identifier(s.as),
                      source: t.stringLiteral(
                        './' + numberToFilename(from, state.modules[from].type),
                      ),
                    }),
                  );
                }
              } else {
                exportStatements.push(
                  TEMPLATES[type].REEXPORT_NAMED({
                    local: t.identifier(s.symbol),
                    name: t.identifier(s.as),
                    source: t.stringLiteral(
                      './' + numberToFilename(from, state.modules[from].type),
                    ),
                  }),
                );
              }
            }
          }

          return [
            `${n}.${type}`,
            generate(
              t.program([
                ...importStatements,
                ...otherStatements,
                ...exportStatements,
              ]),
            ).code,
          ];
        })
        .concat([
          [
            'package.json',
            JSON.stringify(
              {
                sideEffects: modules
                  .map(([n, {type}]) => {
                    if (state.noSideEffects.includes(Number(n))) return;
                    else return `${n}.${type}`;
                  })
                  .filter(Boolean),
              },
              null,
              2,
            ),
          ],
        ]),
    ),
    entries: state.entries.map(n => numberToFilename(n, state.modules[n].type)),
  };
}

function* generateExamples() /*: Iterable<Fixture> */ {
  getNewExportNameNext = 'a';

  let state /*: State */ = {
    modules: {
      [0]: {
        type: 'mjs',
        imported: [],
        exported: [],
      },
    },
    entries: [0],
    noSideEffects: [],
  };

  yield linearizeState(state);
  while (true) {
    state = mutate(state);

    yield linearizeState(state);
  }
}
module.exports = generateExamples;

// $FlowFixMe
// const runESM = require('./runESM');
// (async () => {
//   try {
//     let i = 0;
//     for (let example of generateExamples()) {
//       // console.log(example);
//       // console.log(
//       //   await runESM({
//       //     entries: example.entries.map(f => `/${f}`),
//       //     fs: {
//       //       readFileSync(f) {
//       //         return example.files[path.basename(f)];
//       //       },
//       //     },
//       //   }),
//       // );

//       if (++i > 100) break;
//     }
//   } catch (e) {
//     console.error(e);
//   }
// })();

// (() => {
//   let result = linearizeState({
//     modules: {
//       [0]: {
//         type: 'mjs',
//         imported: [],
//         exported: [
//           {symbol: 'x', as: 'x'},
//           {from: 1, symbol: 'y', as: 'y'},
//         ],
//       },
//       [1]: {
//         type: 'mjs',
//         imported: [],
//         exported: [
//           {symbol: 'y', as: 'y'},
//           {from: 2, symbol: 'z', as: 'z'},
//         ],
//       },
//       [2]: {
//         type: 'mjs',
//         imported: [],
//         exported: [
//           {symbol: 'y', as: 'y'},
//           {from: 3, symbol: '*', as: 'z'},
//           {from: 3, symbol: '*', as: '*'},
//         ],
//       },
//       [3]: {
//         type: 'mjs',
//         imported: [],
//         exported: [{symbol: 'z', as: 'z'}],
//       },
//     },
//     entries: [0],
//     noSideEffects: [3]
//   });
//   console.log(result);
//   // try {
//   //   console.log(
//   //     await runESM({
//   //       entries: result.entries.map(f => `/${f}`),
//   //       fs: {
//   //         readFileSync(f) {
//   //           return result.files[path.basename(f)];
//   //         },
//   //       },
//   //     }),
//   //   );
//   // } catch (e) {
//   //   console.error(e);
//   // }
// })();
