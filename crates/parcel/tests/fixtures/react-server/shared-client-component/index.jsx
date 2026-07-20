import {Page} from './page';
import {Button} from './button';
function Server() {
  return <Page fallback={<Button />} />;
}
output = {Server};
