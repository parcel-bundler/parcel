// @flow strict-local
import type {NamedBundle, PluginLogger} from '@parcel/types';

import type {
  CallExpression,
  VariableDeclaration,
  FunctionExpression,
  ParenthesisExpression,
  Span,
  Identifier,
} from '@swc/core';
import {Visitor} from '@swc/core/Visitor';
import nullthrows from 'nullthrows';

type VisitorOpts = {|
  bundle: NamedBundle,
  logger: PluginLogger,
  assetPublicIdsWithSideEffects: Set<string>,
|};

export class RequireInliningVisitor extends Visitor {
  currentModuleNode: null | FunctionExpression;
  moduleVariables: Set<string>;
  moduleVariableMap: Map<string, CallExpression>;
  dirty: boolean;
  logger: PluginLogger;
  bundle: NamedBundle;
  assetPublicIdsWithSideEffects: Set<string>;

  constructor({bundle, logger, assetPublicIdsWithSideEffects}: VisitorOpts) {
    super();
    this.currentModuleNode = null;
    this.moduleVariables = new Set();
    this.moduleVariableMap = new Map();
    this.dirty = false;
    this.logger = logger;
    this.bundle = bundle;
    this.assetPublicIdsWithSideEffects = assetPublicIdsWithSideEffects;
  }

  visitFunctionExpression(n: FunctionExpression): FunctionExpression {
    // This visitor tries to find module definition functions, these are of the form:
    //
    // parcelRequire.register("moduleId", function (require, module, exports) { ... });
    //
    // We do this to set the vistior variable `inModuleDefinition` for subsequent visits,
    // and also reset the module variable tracking data structures.
    //
    // (TODO: Support arrow functions if we modify the runtime to output arrow functions)
    if (
      n.params.length === 3 &&
      n.params[0].pat.type === 'Identifier' &&
      n.params[0].pat.value === 'require' &&
      n.params[1].pat.type === 'Identifier' &&
      n.params[1].pat.value === 'module' &&
      n.params[2].pat.type === 'Identifier' &&
      n.params[2].pat.value === 'exports'
    ) {
      // `inModuleDefinition` is either null, or the module definition node
      this.currentModuleNode = n;
      this.moduleVariables = new Set();
      this.moduleVariableMap = new Map();
    }

    // Make sure we visit the function itself
    let result = super.visitFunctionExpression(n);

    // only "exit" module definition if we're exiting the module definition node
    if (n === this.currentModuleNode) {
      this.currentModuleNode = null;
    }
    return result;
  }

  visitVariableDeclaration(n: VariableDeclaration): VariableDeclaration {
    // We're looking for variable declarations that look like this:
    //
    // `var $acw62 = require("acw62");`
    let needsReplacement = false;
    for (let i = 0; i < n.declarations.length; i++) {
      let decl = n.declarations[i];
      const init = decl.init;
      if (!init || init.type !== 'CallExpression') {
        continue;
      }

      if (
        ((init.callee.type === 'Identifier' &&
          init.callee.value === 'require') ||
          init.callee.value === 'parcelRequire') &&
        decl.id.value !== 'parcelHelpers' && // ignore var parcelHelpers = require("@parcel/transformer-js/src/esmodule-helpers.js");
        init.arguments[0].expression.type === 'StringLiteral' &&
        typeof decl.id.value === 'string' &&
        decl.id.value.startsWith('$')
      ) {
        const variable = decl.id.value;
        const assetPublicId = variable.substring(1);

        // We need to determine whether the asset we're require'ing has sideEffects - if it does, we
        // shouldn't optimise it to an inline require as the side effects need to run immediately
        //
        // We need to use the public id of the asset (which is the variable name used for requiring it) in
        // order to find the asset in the bundle graph, and check whether `asset.sideEffects` is true - in
        // which case we skip optimising this asset.
        //
        // This won't work in dev mode, because the id used to require the asset isn't the public id
        if (
          this.assetPublicIdsWithSideEffects &&
          this.assetPublicIdsWithSideEffects.has(assetPublicId)
        ) {
          continue;
        }

        // The moduleVariableMap contains a mapping from (e.g. $acw62 -> the AST node `require("acw62")`)
        this.moduleVariableMap.set(variable, init);
        // The moduleVariables set is just the used set of modules (e.g. `$acw62`)
        this.moduleVariables.add(variable);

        // Replace this with a null declarator, we'll use the `init` where it's declared.
        //
        // This mutates `var $acw62 = require("acw62")` -> `var $acw62 = null`
        //
        // The variable will be unused and removed by optimisation
        decl.init = undefined;
        needsReplacement = true;
      } else if (
        decl.id.type === 'Identifier' &&
        typeof decl.id.value === 'string' &&
        decl.id.value.endsWith('Default') &&
        decl.id.value.startsWith('$')
      ) {
        // Handle modules with default values, these look like this in the source:
        // ```
        // var _app = require("./App");
        // var _appDefault = parcelHelpers.interopDefault(_app);
        // ```
        //
        // In this case we want to also put `_appDefault` into the `moduleVariableMap` with the initializer node,
        // but we want to replace `_app` in there with `require("./App")`.. to summarise, this code will end up looking like:
        //
        // ```
        // var _app = null;
        // var _appDefault = null;
        // ```
        //
        // .. and where `_appDefault` is used we replace that with `parcelHelpers.interopDefault(require('./App'))`
        const variable = decl.id.value;
        const baseId = variable.substring(
          0,
          decl.id.value.length - 'Default'.length,
        );
        if (!this.moduleVariables.has(baseId)) {
          continue;
        }
        init.arguments[0] = {
          spread: undefined,
          expression: nullthrows(this.moduleVariableMap.get(baseId)),
        };
        this.moduleVariableMap.set(variable, init);
        this.moduleVariables.add(variable);

        decl.init = undefined;
        needsReplacement = true;
      }
    }
    if (!needsReplacement) {
      return super.visitVariableDeclaration(n);
    } else {
      this.dirty = true;
      return n;
    }
  }

  visitIdentifier(n: Identifier): Identifier {
    // This does the actual replacement - for any identifier within this factory function
    // that is in the `moduleVariables` list, replace the identifier with the original expression
    // that was going to be used to initialise the identifier.
    //
    // The replacement expression uses the `(0, require(...))` pattern to allow for safe replacement
    // in any use cases (since we're replacing a variable access with a function call) - the minifier
    // will take care of optimising this away where possible.
    //
    // e.g.
    // var $abc = require("abc");
    // console.log($abc.foo());
    //
    // becomes
    //
    // var $abc;
    // console.log((0, require("abc")).foo);
    //
    if (this.moduleVariables.has(n.value)) {
      // $FlowFixMe the types don't allow for swapping out the node type here, might need a different approach
      return this.getReplacementExpression(n.value);
    }
    return super.visitIdentifier(n);
  }

  // Helper function to wrap an existing node in a sequence expression, that is, it
  // will take a node `n` and return the AST for `(0, n)`
  //
  // This ensures that the require call can be correctly used in any context - where
  // the sequence is redundant, the minifier will optimise it away.
  getReplacementExpression(id: string): ParenthesisExpression {
    return {
      type: 'ParenthesisExpression',
      span: RequireInliningVisitor.getEmptySpan(),
      expression: {
        type: 'SequenceExpression',
        span: RequireInliningVisitor.getEmptySpan(),
        expressions: [
          {
            type: 'NumericLiteral',
            span: RequireInliningVisitor.getEmptySpan(),
            value: 0,
          },
          nullthrows(this.moduleVariableMap.get(id)),
        ],
      },
    };
  }

  static getEmptySpan(): Span {
    return {start: 0, end: 0, ctxt: 0};
  }
}
