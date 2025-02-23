import '../src/bootstrap';
import {Counter} from '../src/Counter';

export default function StaticPage() {
  return (
    <html>
      <body>
        <h1>Static</h1>
        <Counter />
      </body>
    </html>
  );
}
