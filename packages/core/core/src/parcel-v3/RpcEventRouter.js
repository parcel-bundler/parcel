// @flow

export type HandlerFunc<K, T, R> = [K, T, R];
export type HandlerCallback<T, R> = (data: T) => R | Promise<R>;

export class RpcEventRouter {
  #routes: Map<string, HandlerCallback<any, any>>;

  constructor() {
    this.#routes = new Map();
  }

  on<T: HandlerFunc<any, any, any>>(
    event: T[0],
    callback: HandlerCallback<T[1], T[2]>,
  ) {
    this.#routes.set(event, callback);
  }

  callback: any = async (
    err: any,
    id: string,
    data: any,
    done: any,
  ): Promise<void> => {
    try {
      if (err) {
        done({Err: err});
        return;
      }
      done({Ok: (await this.#on_event(id, data)) ?? undefined});
    } catch (error) {
      done({Err: error});
      return;
    }
  };

  #on_event(id: string, data: any) {
    let handler = this.#routes.get(id);
    if (!handler) {
      throw new Error('Unknown message');
    }
    return handler(data);
  }
}
