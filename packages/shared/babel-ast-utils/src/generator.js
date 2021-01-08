import {baseGenerator, EXPRESSIONS_PRECEDENCE} from 'astring';

export const expressionPrecedence = {
  ...EXPRESSIONS_PRECEDENCE,
  // Babel extensions
  NumericLiteral: EXPRESSIONS_PRECEDENCE.Literal,
  StringLiteral: EXPRESSIONS_PRECEDENCE.Literal,
  BooleanLiteral: EXPRESSIONS_PRECEDENCE.Literal,
  NullLiteral: EXPRESSIONS_PRECEDENCE.Literal,
  RegExpLiteral: EXPRESSIONS_PRECEDENCE.Literal,
  BigIntLiteral: EXPRESSIONS_PRECEDENCE.Literal,
  OptionalMemberExpression: EXPRESSIONS_PRECEDENCE.MemberExpression,
  OptionalCallExpression: EXPRESSIONS_PRECEDENCE.CallExpression,
  Import: EXPRESSIONS_PRECEDENCE.Identifier,
  PrivateName: EXPRESSIONS_PRECEDENCE.Identifier,
};

// Convert Babel's AST format to ESTree on the fly.
// See https://babeljs.io/docs/en/babel-parser#output
export const generator = {
  ...baseGenerator,
  Program(node, state) {
    // Monkeypatch state to fix sourcemap filenames.
    let map = state.map;
    state.map = (str, node) => {
      if (node != null && node.loc != null) {
        state.mapping.source = node.loc.filename;
      }
      map.call(state, str, node);
    };

    if (node.interpreter) {
      state.write(`#!${node.interpreter.value}\n`);
    }

    handleDirectives(node);
    baseGenerator.Program.call(this, node, state);
  },
  BlockStatement(node, state) {
    handleDirectives(node);
    baseGenerator.BlockStatement.call(this, node, state);
  },
  NumericLiteral(node, state) {
    node.type = 'Literal';
    node.raw = getRaw(node);
    this.Literal(node, state);
  },
  StringLiteral(node, state) {
    node.type = 'Literal';
    node.raw = getRaw(node);
    this.Literal(node, state);
  },
  BooleanLiteral(node, state) {
    node.type = 'Literal';
    this.Literal(node, state);
  },
  NullLiteral(node, state) {
    node.type = 'Literal';
    node.raw = 'null';
    node.value = null;
    this.Literal(node, state);
  },
  RegExpLiteral(node, state) {
    node.type = 'Literal';
    node.raw = getRaw(node);
    node.value = {};
    node.regex = {
      pattern: node.pattern,
      flags: node.flags,
    };
    baseGenerator.Literal(node, state);
  },
  BigIntLiteral(node, state) {
    node.type = 'Literal';
    node.raw = getRaw(node);
    this.Literal(node, state);
  },
  ObjectProperty(node, state) {
    node.type = 'Property';
    node.kind = 'init';
    if (node.shorthand) {
      let id =
        node.value.type === 'Identifier'
          ? node.value
          : node.value.type === 'AssignmentPattern' &&
            node.value.left.type === 'Identifier'
          ? node.value.left
          : null;
      if (!id || id.name !== node.key.name) {
        node.shorthand = false;
      }
    }
    this.Property(node, state);
  },
  ObjectMethod(node, state) {
    node.value = {
      type: 'FunctionExpression',
      id: node.id,
      params: node.params,
      body: node.body,
      async: node.async,
      generator: node.generator,
      expression: node.expression,
    };

    node.type = 'Property';
    if (node.kind === 'method') {
      node.kind = 'init';
    }

    this.Property(node, state);
  },
  ClassMethod(node, state) {
    node.value = {
      type: 'FunctionExpression',
      id: node.id,
      params: node.params,
      body: node.body,
      async: node.async,
      generator: node.generator,
      expression: node.expression,
    };

    node.type = 'MethodDefinition';
    this.MethodDefinition(node, state);
  },
  ClassPrivateMethod(node, state) {
    node.value = {
      type: 'FunctionExpression',
      id: node.id,
      params: node.params,
      body: node.body,
      async: node.async,
      generator: node.generator,
      expression: node.expression,
    };

    node.type = 'MethodDefinition';
    this.MethodDefinition(node, state);
  },
  ClassProperty(node, state) {
    if (node.static) {
      state.write('static ');
    }

    if (node.computed) {
      state.write('[');
      this[node.key.type](node.key, state);
      state.write(']');
    } else {
      this[node.key.type](node.key, state);
    }

    if (node.value) {
      state.write(' = ');
      this[node.value.type](node.value, state);
    }

    state.write(';');
  },
  ClassPrivateProperty(node, state) {
    if (node.static) {
      state.write('static ');
    }

    this[node.key.type](node.key, state);
    if (node.value) {
      state.write(' = ');
      this[node.value.type](node.value, state);
    }

    state.write(';');
  },
  PrivateName(node, state) {
    state.write('#' + node.name, node);
  },
  Import(node, state) {
    // astring doesn't support ImportExpression yet
    state.write('import');
  },
  OptionalMemberExpression(node, state) {
    node.optional = true;
    node.type = 'MemberExpression';
    this.MemberExpression(node, state);
  },
  OptionalCallExpression(node, state) {
    node.optional = true;
    node.type = 'CallExpression';
    this.CallExpression(node, state);
  },
  ExportNamedDeclaration(node, state) {
    if (node.source) {
      let namespace = node.specifiers.find(
        specifier => specifier.type === 'ExportNamespaceSpecifier',
      );
      if (namespace) {
        // Babel parser allows combining namespace specifiers and named specifiers
        // e.g. `export * as foo, {bar} from 'other'`, but this is not supported by the spec.
        if (node.specifiers.length > 1) {
          throw new Error(
            'Namespace specifiers cannot be combined with named specifiers',
          );
        }

        node.type = 'ExportAllDeclaration';
        node.exported = namespace.exported;
      }
    }

    baseGenerator[node.type].call(this, node, state);
  },
  ReturnStatement(node, state) {
    // Add parentheses if there are leading comments
    if (node.argument?.leadingComments?.length > 0) {
      let indent = state.indent.repeat(state.indentLevel++);
      state.write('return (' + state.lineEnd + indent + state.indent);
      this[node.argument.type](node.argument, state);
      state.write(state.lineEnd + indent + ');');
    } else {
      baseGenerator.ReturnStatement.call(this, node, state);
    }
  },
};

// Make every node support comments. Important for preserving /*@__PURE__*/ comments for terser.
// TODO: contribute to astring.
for (let key in generator) {
  let orig = generator[key];
  generator[key] = function(node, state) {
    if (node.leadingComments && node.leadingComments.length > 0) {
      formatComments(state, node.leadingComments);
    }
    orig.call(this, node, state);
  };
}

function handleDirectives(node) {
  if (node.directives) {
    for (var i = node.directives.length - 1; i >= 0; i--) {
      var directive = node.directives[i];
      directive.type = 'ExpressionStatement';
      directive.expression = directive.value;
      directive.expression.type = 'Literal';
      node.body.unshift(directive);
    }
  }
}

// Copied from the astring source.
function formatComments(state, comments) {
  // Writes into `state` the provided list of `comments`, with the given `indent` and `lineEnd` strings.
  // Line comments will end with `"\n"` regardless of the value of `lineEnd`.
  // Expects to start on a new unindented line.
  const indent = state.indent.repeat(state.indentLevel);
  const {length} = comments;
  for (let i = 0; i < length; i++) {
    const comment = comments[i];
    if (comment.type === 'CommentLine') {
      // Line comment
      state.write('// ' + comment.value.trim() + state.lineEnd + indent);
    } else {
      // Block comment
      state.write('/*');
      reindent(state, comment.value, indent, state.lineEnd);
      state.write('*/');

      // Keep pure annotations on the same line
      let value = comment.value.trim();
      if (
        !((value === '#__PURE__' || value === '@__PURE__') && i === length - 1)
      ) {
        state.write(state.lineEnd + indent);
      }
    }
  }
}

function reindent(state, text, indent, lineEnd) {
  // Writes into `state` the `text` string reindented with the provided `indent`.
  const lines = text.split('\n');
  const end = lines.length - 1;
  state.write(lines[0].trim());
  if (end > 0) {
    state.write(lineEnd);
    for (let i = 1; i < end; i++) {
      state.write(indent + lines[i].trim() + lineEnd);
    }
    state.write(indent + lines[end].trim());
  }
}

function getRaw(node) {
  let extra = node.extra;
  if (
    extra &&
    extra.raw != null &&
    extra.rawValue != null &&
    node.value === extra.rawValue
  ) {
    return extra.raw;
  }
}
