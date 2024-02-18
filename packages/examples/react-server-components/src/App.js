import Container from './Container.js';

import {Counter} from './Counter.js';
// import {Counter as Counter2} from './Counter2.js';

// import ShowMore from './ShowMore.js';
// import Button from './Button.js';
import {Files} from './Files';
import {Suspense} from 'react';
import './App.css';
// import './bootstrap.js';
// import {like} from './actions.js';

export default async function App() {
  // const res = await fetch('http://localhost:3001/todos');
  // const todos = await res.json();
  let todos = [];
  return (
    <html>
      <head>
        <title>RSC</title>
      </head>
      <body>
        <Container>
          <h1>Hello, world</h1>
          <Counter />
          {/* <Counter2 /> */}
          <ul>
            {todos.map(todo => (
              <li key={todo.id}>{todo.text}</li>
            ))}
          </ul>
          {/* <ShowMore>
            <p>Lorem ipsum</p>
          </ShowMore> */}
          <div>
            {/* <Button action={like}>Like</Button> */}
          </div>
        </Container>
        <Suspense fallback={<>Loading files...</>}>
          <Files />
        </Suspense>
      </body>
    </html>
  );
}
