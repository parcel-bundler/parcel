module.exports = () => (tree) => {
  tree.match({tag: 'div'}, node => {
    node.tag = 'span';
    return node;
  });

  return tree;
};
