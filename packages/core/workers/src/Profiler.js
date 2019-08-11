// @flow
import {Session} from 'inspector';
import invariant from 'assert';

// https://chromedevtools.github.io/devtools-protocol/tot/Profiler#type-Profile
export type Profile = {|
  nodes: Array<ProfileNode>,
  startTime: number,
  endTime: number,
  samples?: Array<number>,
  timeDeltas?: Array<number>
|};

// https://chromedevtools.github.io/devtools-protocol/tot/Profiler#type-ProfileNode
type ProfileNode = {|
  id: number,
  callFrame: CallFrame,
  hitCount?: number,
  children?: Array<number>,
  deoptReason?: string,
  positionTicks?: PositionTickInfo
|};

// https://chromedevtools.github.io/devtools-protocol/tot/Runtime#type-CallFrame
type CallFrame = {|
  functionName: string,
  scriptId: string,
  url: string,
  lineNumber: string,
  columnNumber: string
|};

// https://chromedevtools.github.io/devtools-protocol/tot/Profiler#type-PositionTickInfo
type PositionTickInfo = {|
  line: number,
  ticks: number
|};

export default class Profiler {
  session: Session;

  async startProfiling() {
    this.session = new Session();
    this.session.connect();

    return Promise.all([
      this.sendCommand('Profiler.setSamplingInterval', {
        interval: 100
      }),
      this.sendCommand('Profiler.enable'),
      this.sendCommand('Profiler.start')
    ]);
  }

  async sendCommand(method: string, params: mixed) {
    invariant(this.session != null);
    return new Promise((resolve, reject) => {
      this.session.post(method, params, (err, params) => {
        if (err == null) {
          resolve(params);
        } else {
          reject(err);
        }
      });
    });
  }

  destroy() {
    if (this.session != null) {
      this.session.disconnect();
    }
  }

  async stopProfiling(): Promise<Profile> {
    let res = await this.sendCommand('Profiler.stop');
    this.destroy();
    return res.profile;
  }
}
