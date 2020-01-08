module.exports = function replaceReferences() {
  return {
    name: 'replaceReferences',
    visitor: {
      StringLiteral(path) {
        const value = path.node.value;
        if (value !== '@parcel/watcher' && value.startsWith('@parcel/')) {
          path.node.value = value.replace(/^@parcel\//, '@atlassian/parcel-');
        }
      },
    },
  };
};
