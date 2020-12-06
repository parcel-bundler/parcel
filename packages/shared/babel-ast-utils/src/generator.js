import {baseGenerator} from 'astring';

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
    this.Literal(node, state);
  },
  StringLiteral(node, state) {
    node.type = 'Literal';
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
    node.raw = node.extra.raw;
    node.value = {};
    node.regex = {
      pattern: node.pattern,
      flags: node.flags,
    };
    this.Literal(node, state);
  },
  BigIntLiteral(node, state) {
    node.type = 'Literal';
    node.raw = node.extra.raw;
    this.Literal(node, state);
  },
  ObjectProperty(node, state) {
    node.type = 'Property';
    node.kind = 'init';
    if (node.shorthand && node.value.type !== 'Identifier' || node.value.name !== node.key.name) {
      node.shorthand = false;
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
  Import(node, state) {
    // astring doesn't support ImportExpression yet
    state.write('import');
  },
  // TODO: OptionalMemberExpression, OptionalCallExpression once astring supports ChainExpression
};

// Make every node support comments. Important for preserving /*@__PURE__*/ comments for terser.
// TODO: contribute to astring.
for (let key in generator) {
  let orig = generator[key];
  generator[key] = function (node, state) {
    if (node.leadingComments && node.leadingComments.length > 0) {
      formatComments(state, node.leadingComments)
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
  const { length } = comments
  for (let i = 0; i < length; i++) {
    const comment = comments[i]
    state.write(indent)
    if (comment.type === 'CommentLine') {
      // Line comment
      state.write('// ' + comment.value.trim() + state.lineEnd);
    } else {
      // Block comment
      state.write('/*');
      reindent(state, comment.value, indent, state.lineEnd);
      state.write('*/');

      // Keep pure annotations on the same line
      let value = comment.value.trim();
      if (value !== '#__PURE__' && value !== '@__PURE__') {
        state.write(state.lineEnd + indent);
      }
    }
  }
}

function reindent(state, text, indent, lineEnd) {
  // Writes into `state` the `text` string reindented with the provided `indent`.
  const lines = text.split('\n')
  const end = lines.length - 1
  state.write(lines[0].trim())
  if (end > 0) {
    state.write(lineEnd)
    for (let i = 1; i < end; i++) {
      state.write(indent + lines[i].trim() + lineEnd)
    }
    state.write(indent + lines[end].trim())
  }
}
