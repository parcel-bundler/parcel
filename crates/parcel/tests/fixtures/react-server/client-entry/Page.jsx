'use server-entry';
import {Client} from './Client';
import './client-entry.jsx';
export function Server() {
  return <Client />;
}
