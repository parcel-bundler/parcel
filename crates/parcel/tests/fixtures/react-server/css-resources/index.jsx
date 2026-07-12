import {Server, foo} from './Page.jsx';
function render() {
  return <Server />;
}
output = {render, foo: foo.map(value => value * 2)};
