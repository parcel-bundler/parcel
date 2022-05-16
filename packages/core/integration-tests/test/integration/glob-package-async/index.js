const scoped = import('@scope/pkg/foo/*.js');
const unscoped = import('pkg/bar/*.js');

module.exports = async function () {
    await promise.all([scoped, unscoped]);
    return scoped.a + scoped.b + unscoped.x + unscoped.y;
}