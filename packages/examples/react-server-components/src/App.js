import Container from './Container.js';
import {Counter} from './Counter.js';
import Button from './Button.js';
import {Files} from './Files';
import {Suspense} from 'react';
import './App.css';
import {getServerState} from './ServerState';
import {like} from './actions.js';

export default async function App() {
  let todos = [];
  return (
    <html>
      <head>
        <title>RSC</title>
      </head>
      <body>
        <Container>
          <h1>{getServerState()}</h1>
          <Counter />
          <ul>
            {todos.map(todo => (
              <li key={todo.id}>{todo.text}</li>
            ))}
          </ul>
          <div>
            <Button action={like.bind(null, 'hi')}>Like server action</Button>
          </div>
          <form>
            <button formAction={like.bind(null, 'yoo')}>Like form</button>
          </form>
        </Container>
        <Suspense fallback={<>Loading files...</>}>
          <Files />
        </Suspense>
      </body>
    </html>
  );
}
