const scoped = import('@scope/pkg/foo/*.js');
const unscoped = import('pkg/bar/*.js');

module.exports = async function () {
    return await scoped.a() + await scoped.b() + await unscoped.x() + await unscoped.y();
}