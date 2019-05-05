const t = require('@babel/types');

module.exports = {
  MemberExpression(path, asset) {
    const {node} = path;
    // Inline environment variables accessed on process.env
    if (t.matchesPattern(node.object, 'process.env')) {
      let key = t.toComputedKey(node);
      if (t.isStringLiteral(key)) {
        let prop = process.env[key.value];
        if (typeof prop !== 'function') {
          let value = t.valueToNode(prop);
          morphEnv(node, value);
          eliminateDead(path);
          asset.isAstDirty = true;
          asset.cacheData.env[key.value] = process.env[key.value];
        }
      }
    }

    // Inline process.browser
    if (t.matchesPattern(node, 'process.browser')) {
      if (t.isAssignmentExpression(path.parentPath)) {
        path.parentPath.remove();
      } else {
        path.replaceWith(t.booleanLiteral(true));
        eliminateDead(path);
        asset.isAstDirty = true;
      }
    }
  }
};

// replace object properties
function morphEnv(object, newProperties) {
  for (let key in object) {
    delete object[key];
  }

  for (let key in newProperties) {
    object[key] = newProperties[key];
  }
}

function eliminateDead(path) {
  if (t.isUnaryExpression(path.parent, {operator: '!'})) {
    path = path.parentPath;
  }
  if (t.isBinaryExpression(path.parent)) {
    path = path.parentPath;
  }
  if (t.isLogicalExpression(path.parent)) {
    path = getLogicalExpressionParent(path);
  }

  if (path.parentPath.removed) {
    return;
  }

  if (
    !t.isIfStatement(path.parent) &&
    !t.isConditionalExpression(path.parent)
  ) {
    return;
  }

  const result = getConfidentResult(path);
  if (!result.confident) {
    return;
  }
  if (result.value) {
    // handle early returns
    if (path.parent.consequent.body) {
      const ends = path.parent.consequent.body.some(t.isReturnStatement);
      if (ends) {
        const index = path.parentPath.container.findIndex(
          c => c === path.parent
        );
        // remove code after if block
        if (index !== -1) {
          path.parentPath.container.splice(index + 1);
        }
      }
    }
    path.parentPath.replaceWith(path.parent.consequent);
    return;
  }
  if (!result.value && path.parent.alternate) {
    path.parentPath.replaceWith(path.parent.alternate);
    return;
  }
  path.parentPath.remove();
}

function getConfidentResult(path) {
  const result = path.evaluate();
  if (!result.confident && path.node.operator === '||') {
    const right = path.get('right');
    if (right && right.evaluate().confident) {
      return right.evaluate();
    }
    return getConfidentResult(path.get('left'));
  }
  return result;
}

function getLogicalExpressionParent(path) {
  if (t.isLogicalExpression(path.parentPath)) {
    return getLogicalExpressionParent(path.parentPath);
  }
  return path;
}
