import {use} from 'react' with {env: 'react-client'};
import {Page1} from './Page1.jsx';
import {Page2} from './Page2.jsx';
function render() {
  use(stuff);
  return <Page1 /> || <Page2 />;
}
output = {render};
