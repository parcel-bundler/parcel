export class Message {
  msg: string;
  constructor(msg: string) {
    this.msg = msg;
  }
}

export function createMessage(msg: string) {
  return new Message(msg);
}

export default 'unused';
