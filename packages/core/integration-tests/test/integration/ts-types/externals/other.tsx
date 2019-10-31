import {ReactNode} from 'react';

interface OtherProps {
  children: ReactNode
}

export function OtherComponent(props: Props) {
  return <div>{props.children}</div>;
}
