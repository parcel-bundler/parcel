export default () => {
    return Promise.all([
import('./uses-static-component').then(c => {
    return c.default()();
}),
import('./uses-static-component-async').then(c => {
    return c.default();
}).then(s => {
    return s();
})]);
}