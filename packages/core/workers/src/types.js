// @flow
import type {WorkerMessage} from '@parcel/types';

export type MessageHandler = (data: WorkerMessage) => void;
export type ErrorHandler = (err: Error) => void;
export type ExitHandler = (code: number) => void;
export interface WorkerImpl {
  constructor(
    execArgv: Object,
    onMessage: MessageHandler,
    onError: ErrorHandler,
    onExit: ExitHandler,
  ): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(data: WorkerMessage): void;
}

export interface ChildImpl {
  constructor(onMessage: MessageHandler, onExit: ExitHandler): void;
  send(data: WorkerMessage): void;
}

export type BackendType = 'threads' | 'process';
