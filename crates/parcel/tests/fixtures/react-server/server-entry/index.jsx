import {use} from 'react' with {env: 'react-client'};
import {Server} from './App.jsx';

function render() {
  use(stuff);
  return <Server />;
}
output = {render};
