import {h} from 'preact';
import {useState} from 'preact/hooks';
import './styles.css';

export function App() {
  const [v] = useState(Math.random());
  const [w] = useState(Math.random());

  return (
    <div class="custom" style={{background: 'green'}}>
      Test <br />
      {v} <br /> {w}
    </div>
  );
}
