import {Page1} from './Page1.jsx';
import {Page2} from './Page2.jsx';

function render() {
  return <Page1 /> || <Page2 />;
}
output = {render};
