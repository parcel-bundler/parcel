/// <reference types="node" />
import type {Session} from 'inspector';
export type Profile = {
  nodes: Array<ProfileNode>;
  startTime: number;
  endTime: number;
  samples?: Array<number>;
  timeDeltas?: Array<number>;
};
type ProfileNode = {
  id: number;
  callFrame: CallFrame;
  hitCount?: number;
  children?: Array<number>;
  deoptReason?: string;
  positionTicks?: PositionTickInfo;
};
type CallFrame = {
  functionName: string;
  scriptId: string;
  url: string;
  lineNumber: string;
  columnNumber: string;
};
type PositionTickInfo = {
  line: number;
  ticks: number;
};
export default class SamplingProfiler {
  session: Session;
  startProfiling(): Promise<unknown>;
  sendCommand(
    method: string,
    params?: unknown,
  ): Promise<{
    profile: Profile;
  }>;
  destroy(): void;
  stopProfiling(): Promise<Profile>;
}
export {};
