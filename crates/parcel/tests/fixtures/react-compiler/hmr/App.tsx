import {useState} from 'react';
import {Lib} from 'lib';

interface Props {
  items: string[];
}

export function App({items}: Props) {
  let [prefix] = useState<string>('#');
  let labels = items.map(item => prefix + item);
  return (
    <ul>
      {labels.map(label => <li key={label}>{label}</li>)}
      <Lib />
    </ul>
  );
}
