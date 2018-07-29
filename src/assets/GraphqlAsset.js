const os = require('os');
const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');

// Takes `source` (the source GraphQL query string)
// and `doc` (the parsed GraphQL document) and tacks on
// the imported definitions.
function expandImports(source) {
  const lines = source.split(/\r\n|\r|\n/);
  let outputCode = `
    var names = {};
    function unique(defs) {
      return defs.filter(
        function(def) {
          if (def.kind !== 'FragmentDefinition') return true;
          var name = def.name.value
          if (names[name]) {
            return false;
          } else {
            names[name] = true;
            return true;
          }
        }
      )
    }
  `;

  lines.some(line => {
    if (line[0] === '#' && line.slice(1).split(' ')[0] === 'import') {
      const importFile = line.slice(1).split(' ')[1];
      const parseDocument = `require(${importFile})`;
      const appendDef = `doc.definitions = doc.definitions.concat(unique(${parseDocument}.definitions));`;
      outputCode += appendDef + os.EOL;
    }
    return line.length !== 0 && line[0] !== '#';
  });

  return outputCode;
}

class GraphqlAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'js';
  }

  async parse(code) {
    let gql = await localRequire('graphql-tag', this.name);

    const doc = gql(code);
    let headerCode = `
      var doc = ${JSON.stringify(doc)};
      doc.loc.source = ${JSON.stringify(doc.loc.source)};
    `;

    let outputCode = '';

    // Allow multiple query/mutation definitions in a file. This parses out dependencies
    // at compile time, and then uses those at load time to create minimal query documents
    // We cannot do the latter at compile time due to how the #import code works.
    let operationCount = doc.definitions.reduce(function(accum, op) {
      if (op.kind === 'OperationDefinition') {
        return accum + 1;
      }

      return accum;
    }, 0);

    if (operationCount < 1) {
      outputCode += `
        module.exports = doc;
      `;
    } else {
      outputCode += `
      // Collect any fragment/type references from a node, adding them to the refs Set
      function collectFragmentReferences(node, refs) {
        if (node.kind === "FragmentSpread") {
          refs.add(node.name.value);
        } else if (node.kind === "VariableDefinition") {
          var type = node.type;
          if (type.kind === "NamedType") {
            refs.add(type.name.value);
          }
        }
        if (node.selectionSet) {
          node.selectionSet.selections.forEach(function(selection) {
            collectFragmentReferences(selection, refs);
          });
        }
        if (node.variableDefinitions) {
          node.variableDefinitions.forEach(function(def) {
            collectFragmentReferences(def, refs);
          });
        }
        if (node.definitions) {
          node.definitions.forEach(function(def) {
            collectFragmentReferences(def, refs);
          });
        }
      }
      var definitionRefs = {};
      (function extractReferences() {
        doc.definitions.forEach(function(def) {
          if (def.name) {
            var refs = new Set();
            collectFragmentReferences(def, refs);
            definitionRefs[def.name.value] = refs;
          }
        });
      })();
      function findOperation(doc, name) {
        for (var i = 0; i < doc.definitions.length; i++) {
          var element = doc.definitions[i];
          if (element.name && element.name.value == name) {
            return element;
          }
        }
      }
      function oneQuery(doc, operationName) {
        // Copy the DocumentNode, but clear out the definitions
        var newDoc = {
          kind: doc.kind,
          definitions: [findOperation(doc, operationName)]
        };
        if (doc.hasOwnProperty("loc")) {
          newDoc.loc = doc.loc;
        }
        // Now, for the operation we're running, find any fragments referenced by
        // it or the fragments it references
        var opRefs = definitionRefs[operationName] || new Set();
        var allRefs = new Set();
        var newRefs = new Set(opRefs);
        while (newRefs.size > 0) {
          var prevRefs = newRefs;
          newRefs = new Set();
          prevRefs.forEach(function(refName) {
            if (!allRefs.has(refName)) {
              allRefs.add(refName);
              var childRefs = definitionRefs[refName] || new Set();
              childRefs.forEach(function(childRef) {
                newRefs.add(childRef);
              });
            }
          });
        }
        allRefs.forEach(function(refName) {
          var op = findOperation(doc, refName);
          if (op) {
            newDoc.definitions.push(op);
          }
        });
        return newDoc;
      }
      module.exports = doc;
      `;

      for (const op of doc.definitions) {
        if (op.kind === 'OperationDefinition') {
          if (!op.name) {
            if (operationCount > 1) {
              throw 'Query/mutation names are required for a document with multiple definitions';
            } else {
              continue;
            }
          }

          const opName = op.name.value;
          outputCode += `
          module.exports["${opName}"] = oneQuery(doc, "${opName}");
          `;
        }
      }
    }

    const importOutputCode = expandImports(code, doc);
    const allCode =
      headerCode + os.EOL + importOutputCode + os.EOL + outputCode + os.EOL;

    return allCode;
  }

  generate() {
    return this.ast;
  }
}

module.exports = GraphqlAsset;
