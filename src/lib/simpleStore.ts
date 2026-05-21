type StatePatch<T> = Partial<T> | ((state: T) => Partial<T>);
type Listener<T> = (state: T, previous: T) => void;

export type SimpleStore<T> = {
  (): T;
  <U>(selector: (state: T) => U): U;
  getState: () => T;
  setState: (patch: StatePatch<T>) => void;
  subscribe: (listener: Listener<T>) => () => void;
};

export function createSimpleStore<T>(
  initializer: (
    set: (patch: StatePatch<T>) => void,
    get: () => T,
  ) => T,
): SimpleStore<T> {
  let state: T;
  const listeners = new Set<Listener<T>>();

  const get = () => state;
  const set = (patch: StatePatch<T>) => {
    const previous = state;
    const partial = typeof patch === "function" ? patch(state) : patch;
    state = { ...state, ...partial };
    if (state === previous) return;
    for (const listener of listeners) listener(state, previous);
  };

  const store = (<U>(selector?: (state: T) => U) =>
    selector ? selector(state) : state) as SimpleStore<T>;
  store.getState = get;
  store.setState = set;
  store.subscribe = (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  state = initializer(set, get);
  return store;
}
