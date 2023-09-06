const {Visitor} = require('@swc/core/Visitor');

/** @typedef {import('@swc/core').Program} Program */
/** @typedef {import('@swc/core').ExportDeclaration} ExportDeclaration */
/** @typedef {import('@swc/core').Expression} Expression */
/** @typedef {import('@swc/core').TsType} TsType */
/** @typedef {import('@swc/core').Property} Property */
/** @typedef {import('@swc/core').ObjectExpression} ObjectExpression */
/** @typedef {{ start: number, end: number }} Span */
/** @typedef {{ specifier: string, value: any }} ConstantExport */

/**
 * This Visitor will find dynamic import expressions with `webpackChunkName` comments,
 * and convert these to query params on the import. These query params are later used
 * by the complementary Namer plugin in order to name the async bundles according to
 * the query param.
 */
class ConstantVisitor extends Visitor {
  /** @type {number} */
  modifiedImportCount;

  /** @type {string} */
  code;

  /** @type {number} */
  offset;

  /** @type {Map<string, string>} */
  constantExports;

  constructor(/** @type {string} */ code) {
    super();

    this.modifiedImportCount = 0;
    this.code = code;
    this.offset = 0;
    this.constantExports = new Map();
  }

  /** @type {(node: Program) => Program} */
  visitProgram(node) {
    this.offset = node.span.start;
    return super.visitProgram(node);
  }

  /** @type {(span: Span) => Span} */
  fixSpan(span) {
    return {
      start: span.start - this.offset,
      end: span.end - this.offset,
    };
  }

  addConstantExport(specifier, value) {
    if (typeof value === 'string') {
      value = `"${value}"`;
    }

    this.constantExports.set(specifier, value);
  }

  /** @type {(n: ObjectExpression) => ObjectExpression} */
  addObjectExports(specifier, properties) {
    for (const property of properties) {
      const objectSpecifier = `${specifier}.${property.key.value}`;
      if (property.value.type.endsWith('Literal')) {
        this.addConstantExport(objectSpecifier, property.value.value);
      } else if (property.value.type == 'ObjectExpression') {
        this.addObjectExports(objectSpecifier, property.value.properties);
      }
    }
  }

  visitExportDeclaration(node) {
    if (
      node.declaration.type === 'VariableDeclaration' &&
      node.declaration.kind === 'const'
    ) {
      for (const declaration of node.declaration.declarations) {
        if (declaration.init?.type.endsWith('Literal')) {
          this.addConstantExport(declaration.id.value, declaration.init.value);
        } else if (declaration.init?.type == 'ObjectExpression') {
          this.addObjectExports(
            declaration.id.value,
            declaration.init.properties,
          );
        }
      }
    }
    return super.visitExportDeclaration(node);
  }

  visitExportDefaultExpression(node) {
    if (node.expression.type.endsWith('Literal')) {
      this.addConstantExport('default', node.expression.value);
    }

    return super.visitExportDefaultExpression(node);
  }

  /** @type {(n: TsType) => TsType} */
  // For some reason the Visitor class has a noop method with a throw for this
  // eslint-disable-next-line class-methods-use-this
  visitTsType(n) {
    return n;
  }
}

exports.ConstantVisitor = ConstantVisitor;
