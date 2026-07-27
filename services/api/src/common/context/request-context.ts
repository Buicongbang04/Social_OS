import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  /** Propagated to logs, the error envelope and downstream calls. */
  correlationId: string;
  userId?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Ambient per-request data. Using AsyncLocalStorage rather than passing a
 * context object through every signature keeps the correlation id available
 * to loggers and the exception filter without polluting service APIs.
 */
export const requestContext = {
  run<T>(context: RequestContext, callback: () => T): T {
    return storage.run(context, callback);
  },

  get(): RequestContext | undefined {
    return storage.getStore();
  },

  correlationId(): string {
    return storage.getStore()?.correlationId ?? "unknown";
  },

  setUserId(userId: string): void {
    const store = storage.getStore();
    if (store) store.userId = userId;
  },
};
