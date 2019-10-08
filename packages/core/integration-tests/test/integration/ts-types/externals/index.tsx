import {ReactNode} from 'react';
import {OtherComponent} from './other';

interface Props {
  children: ReactNode
}

export function Component(props: Props) {
  return <OtherComponent>{props.children}</OtherComponent>;
}
