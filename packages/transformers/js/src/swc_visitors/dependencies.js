// @flow
import Visitor from '@swc/core/Visitor';
import {isURL, md5FromString, createDependencyLocation} from '@parcel/utils';

export class DependencyVisitor extends Visitor {
  constructor(asset) {
    super();
    this.asset = asset;
  }

  visitImportDeclaration(node) {
    this.asset.meta.isES6Module = true;
    addDependency(this.asset, node.source);
    return node;
  }

  visitExportDeclaration(node) {
    this.asset.meta.isES6Module = true;
    return node;
  }

  // TODO: file bug for spelling :)
  visitExportNamedDeclration(node) {
    this.asset.meta.isES6Module = true;
    if (node.source) {
      addDependency(this.asset, node.source);
    }

    return node;
  }

  // TODO: file bug for spelling :)
  visitExportAllDeclration(node) {
    this.asset.meta.isES6Module = true;
    addDependency(this.asset, node.source);
    return node;
  }

  visitExportDefaultDeclaration(node) {
    this.asset.meta.isES6Module = true;
    return node;
  }

  visitExportDefaultExpression(node) {
    this.asset.meta.isES6Module = true;
    return node;
  }

  visitCallExpression(node) {
    let {callee, arguments: args} = node;

    let isRequire =
      callee.type === 'Identifier' &&
      callee.value === 'require' &&
      args.length === 1 &&
      args[0].expression &&
      args[0].expression.type === 'StringLiteral'; // &&
    // !hasBinding(ancestors, 'require') &&
    // !isInFalsyBranch(ancestors);

    if (isRequire) {
      // let isOptional =
      //   ancestors.some(a => types.isTryStatement(a)) || undefined;
      let isOptional = undefined;
      // invariant(asset.ast);
      // let isAsync = isRequireAsync(ancestors, node, this.asset.ast);
      let isAsync = undefined;
      console.log('DEP', args[0].expression);
      addDependency(this.asset, args[0].expression, {isOptional, isAsync});
      return node;
    }

    // let isDynamicImport =
    //   callee.type === 'Import' &&
    //   args.length === 1 &&
    //   types.isStringLiteral(args[0]);

    // if (isDynamicImport) {
    //   // Ignore dynamic imports of fully specified urls
    //   if (isURL(args[0].value)) {
    //     return;
    //   }

    //   addDependency(asset, args[0], {isAsync: true});

    //   node.callee = types.identifier('require');
    //   invariant(asset.ast);
    //   asset.ast.isDirty = true;
    //   return;
    // }
    return node;
  }
}

function addDependency(
  asset,
  node,
  opts: ?{|isAsync?: boolean, isOptional?: boolean|},
) {
  asset.addDependency({
    moduleSpecifier: node.value,
    loc: node.loc && createDependencyLocation(node.loc.start, node.value, 0, 1),
    isAsync: opts ? opts.isAsync : false,
    isOptional: opts ? opts.isOptional : false,
  });
}
