'use server-entry';
import './server.css';
sideEffect('page before');
export const foo = await Promise.resolve([1, 2, 3]);
sideEffect('page after');
export function Server() {
  return <h1>Server</h1>;
}
export default function Page() {
  return <Server />;
}
