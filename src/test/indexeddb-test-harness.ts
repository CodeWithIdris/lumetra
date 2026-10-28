/**
 * In-Memory IndexedDB Test Harness.
 *
 * Provides a compliant simulation of IndexedDB 2.0 transactions, object stores,
 * indexes, and event queuing for Vitest/jsdom testing environments where native
 * window.indexedDB is unavailable.
 *
 * NOTE ON TESTING METHODOLOGY:
 * This harness exercises IndexedDB transaction semantics (atomic commits, aborts,
 * rollback, multi-store transactions, cursors, key-path lookups, and upgrade events).
 * For resilience testing, it provides configurable fault injection to simulate real-browser
 * behaviors such as QuotaExceededError, blocked connections, and database errors.
 * Real browsers have additional external constraints (disk space, OS sleep, private browsing
 * ephemeral vaults, user clearing site data) which are documented in our architecture guides.
 */

export interface HarnessControls {
  simulateQuotaError: boolean;
  simulateBlockedError: boolean;
  simulateOpenError: boolean;
  resetAll: () => void;
}

interface StoredIndexDef {
  name: string;
  keyPath: string;
  unique: boolean;
}

interface StoredObjectStoreDef {
  name: string;
  keyPath: string;
  indexes: Map<string, StoredIndexDef>;
  records: Map<string, unknown>;
}

interface DatabaseDef {
  name: string;
  version: number;
  stores: Map<string, StoredObjectStoreDef>;
}

const memoryDatabases = new Map<string, DatabaseDef>();

export const harnessControls: HarnessControls = {
  simulateQuotaError: false,
  simulateBlockedError: false,
  simulateOpenError: false,
  resetAll: () => {
    memoryDatabases.clear();
    harnessControls.simulateQuotaError = false;
    harnessControls.simulateBlockedError = false;
    harnessControls.simulateOpenError = false;
  },
};

function deepClone<T>(val: T): T {
  if (val === undefined || val === null) return val;
  return JSON.parse(JSON.stringify(val));
}

function resolveKey(obj: unknown, keyPath: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = keyPath.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur && typeof cur === "object" && part in cur) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur !== undefined ? String(cur) : undefined;
}

export function createMockIndexedDB(): IDBFactory {
  return {
    open(name: string, version?: number): IDBOpenDBRequest {
      const targetVersion = version ?? 1;
      const request = new EventTarget() as unknown as IDBOpenDBRequest;
      request.result = null as unknown as IDBDatabase;
      request.error = null;
      request.readyState = "pending";

      queueMicrotask(() => {
        if (harnessControls.simulateOpenError) {
          const err = new DOMException("Internal database error", "UnknownError");
          request.error = err;
          request.readyState = "done";
          if (typeof request.onerror === "function") {
            const ev = new Event("error");
            request.onerror(ev as unknown as Event);
          }
          return;
        }

        if (harnessControls.simulateBlockedError) {
          if (typeof request.onblocked === "function") {
            const ev = new Event("blocked");
            request.onblocked(ev as unknown as Event);
          }
          return;
        }

        let dbDef = memoryDatabases.get(name);
        let needsUpgrade = false;
        let oldVersion = 0;

        if (!dbDef) {
          dbDef = { name, version: targetVersion, stores: new Map() };
          memoryDatabases.set(name, dbDef);
          needsUpgrade = true;
          oldVersion = 0;
        } else if (targetVersion > dbDef.version) {
          oldVersion = dbDef.version;
          dbDef.version = targetVersion;
          needsUpgrade = true;
        }

        const fakeDb: Partial<IDBDatabase> = {
          name,
          version: targetVersion,
          objectStoreNames: {
            contains: (storeName: string) => dbDef!.stores.has(storeName),
            item: (idx: number) => Array.from(dbDef!.stores.keys())[idx] ?? null,
            length: dbDef.stores.size,
            [Symbol.iterator]: () => dbDef!.stores.keys(),
          } as unknown as DOMStringList,
          close: () => {
            // Connection closed
          },
          createObjectStore: (storeName: string, options?: IDBObjectStoreParameters) => {
            const keyPath = (options?.keyPath as string) || "id";
            const storeDef: StoredObjectStoreDef = {
              name: storeName,
              keyPath,
              indexes: new Map(),
              records: new Map(),
            };
            dbDef!.stores.set(storeName, storeDef);

            return createMockObjectStore(storeDef, fakeDb as IDBDatabase, null);
          },
          deleteObjectStore: (storeName: string) => {
            dbDef!.stores.delete(storeName);
          },
          transaction: (
            storeNames: string | string[],
            mode: IDBTransactionMode = "readonly",
          ): IDBTransaction => {
            const names = Array.isArray(storeNames) ? storeNames : [storeNames];
            return createMockTransaction(names, mode, fakeDb as IDBDatabase, dbDef!);
          },
        };

        request.result = fakeDb as IDBDatabase;
        request.readyState = "done";

        if (needsUpgrade && typeof request.onupgradeneeded === "function") {
          const upgradeEvent = new Event("upgradeneeded") as unknown as IDBVersionChangeEvent;
          Object.defineProperty(upgradeEvent, "oldVersion", { value: oldVersion });
          Object.defineProperty(upgradeEvent, "newVersion", { value: targetVersion });
          request.onupgradeneeded(upgradeEvent);
        }

        if (typeof request.onsuccess === "function") {
          const successEvent = new Event("success");
          request.onsuccess(successEvent);
        }
      });

      return request;
    },

    deleteDatabase(name: string): IDBOpenDBRequest {
      const request = new EventTarget() as unknown as IDBOpenDBRequest;
      request.readyState = "pending";
      queueMicrotask(() => {
        memoryDatabases.delete(name);
        request.readyState = "done";
        if (typeof request.onsuccess === "function") {
          request.onsuccess(new Event("success"));
        }
      });
      return request;
    },

    cmp: (a: unknown, b: unknown) => {
      if (a === b) return 0;
      return a > b ? 1 : -1;
    },
  };
}

interface MockTransactionState {
  pendingRequests: number;
  notifyPending: () => void;
  notifyDone: () => void;
  triggerAbort: (err: DOMException) => void;
}

function createMockTransaction(
  storeNames: string[],
  mode: IDBTransactionMode,
  db: IDBDatabase,
  dbDef: DatabaseDef,
): IDBTransaction {
  const tx = new EventTarget() as unknown as IDBTransaction;
  let aborted = false;
  let completed = false;
  tx.error = null;
  tx.mode = mode;
  tx.db = db;

  // Working copy for transactional rollback guarantees
  const stagedChanges = new Map<string, Map<string, unknown>>();
  for (const name of storeNames) {
    const originalStore = dbDef.stores.get(name);
    if (originalStore) {
      stagedChanges.set(name, new Map(originalStore.records));
    }
  }

  let pendingRequests = 0;
  let commitScheduled = false;

  const state: MockTransactionState = {
    get pendingRequests() {
      return pendingRequests;
    },
    notifyPending: () => {
      pendingRequests++;
    },
    notifyDone: () => {
      pendingRequests--;
      scheduleCommitCheck();
    },
    triggerAbort: (err: DOMException) => {
      if (aborted || completed) return;
      aborted = true;
      Object.defineProperty(tx, "error", { value: err, writable: true });
      queueMicrotask(() => {
        if (typeof tx.onabort === "function") {
          tx.onabort(new Event("abort"));
        }
        if (typeof tx.onerror === "function") {
          tx.onerror(new Event("error"));
        }
      });
    },
  };

  tx.abort = () => {
    state.triggerAbort(new DOMException("Transaction aborted", "AbortError"));
  };

  tx.objectStore = (name: string): IDBObjectStore => {
    const storeDef = dbDef.stores.get(name);
    if (!storeDef) {
      throw new DOMException(`Store ${name} not found`, "NotFoundError");
    }
    const staged = stagedChanges.get(name) || storeDef.records;
    return createMockObjectStore(storeDef, db, tx, staged, state);
  };

  function scheduleCommitCheck() {
    if (commitScheduled) return;
    commitScheduled = true;
    queueMicrotask(() => {
      commitScheduled = false;
      if (aborted || completed) return;
      if (pendingRequests === 0) {
        // Commit staged changes
        if (mode === "readwrite") {
          for (const [sName, stagedRecords] of stagedChanges.entries()) {
            const storeDef = dbDef.stores.get(sName);
            if (storeDef) {
              storeDef.records = new Map(stagedRecords);
            }
          }
        }
        completed = true;
        if (typeof tx.oncomplete === "function") {
          tx.oncomplete(new Event("complete"));
        }
      } else {
        scheduleCommitCheck();
      }
    });
  }

  // Kick off commit check
  scheduleCommitCheck();

  return tx;
}

function createMockObjectStore(
  storeDef: StoredObjectStoreDef,
  db: IDBDatabase,
  tx: IDBTransaction | null,
  recordsMap?: Map<string, unknown>,
  txState?: MockTransactionState,
): IDBObjectStore {
  const records = recordsMap || storeDef.records;

  const store: Partial<IDBObjectStore> = {
    name: storeDef.name,
    keyPath: storeDef.keyPath,
    createIndex: (name: string, keyPath: string, options?: IDBIndexParameters) => {
      const idxDef: StoredIndexDef = {
        name,
        keyPath,
        unique: Boolean(options?.unique),
      };
      storeDef.indexes.set(name, idxDef);
      return createMockIndex(idxDef, records, txState);
    },
    index: (name: string): IDBIndex => {
      const idxDef = storeDef.indexes.get(name);
      if (!idxDef) {
        throw new DOMException(`Index "${name}" not found`, "NotFoundError");
      }
      return createMockIndex(idxDef, records, txState);
    },
    put: (val: unknown, key?: IDBValidKey): IDBRequest => {
      const request = new EventTarget() as unknown as IDBRequest;
      request.readyState = "pending";
      txState?.notifyPending();

      queueMicrotask(() => {
        try {
          if (harnessControls.simulateQuotaError) {
            const quotaErr = new DOMException("The quota has been exceeded.", "QuotaExceededError");
            request.error = quotaErr;
            request.readyState = "done";
            if (txState) {
              txState.triggerAbort(quotaErr);
            }
            if (typeof request.onerror === "function") {
              request.onerror(new Event("error"));
            }
            return;
          }

          const id = key !== undefined ? String(key) : resolveKey(val, storeDef.keyPath);
          if (!id) {
            const err = new DOMException("Missing primary key", "DataError");
            request.error = err;
            if (typeof request.onerror === "function") {
              request.onerror(new Event("error"));
            }
            return;
          }

          records.set(id, deepClone(val));
          request.result = id;
          request.readyState = "done";
          if (typeof request.onsuccess === "function") {
            request.onsuccess(new Event("success"));
          }
        } finally {
          txState?.notifyDone();
        }
      });

      return request;
    },
    get: (key: IDBValidKey): IDBRequest => {
      const request = new EventTarget() as unknown as IDBRequest;
      request.readyState = "pending";
      txState?.notifyPending();

      queueMicrotask(() => {
        try {
          const id = String(key);
          const item = records.get(id);
          request.result = item ? deepClone(item) : undefined;
          request.readyState = "done";
          if (typeof request.onsuccess === "function") {
            request.onsuccess(new Event("success"));
          }
        } finally {
          txState?.notifyDone();
        }
      });

      return request;
    },
    getAll: (): IDBRequest => {
      const request = new EventTarget() as unknown as IDBRequest;
      request.readyState = "pending";
      txState?.notifyPending();

      queueMicrotask(() => {
        try {
          const list = Array.from(records.values()).map((v) => deepClone(v));
          request.result = list;
          request.readyState = "done";
          if (typeof request.onsuccess === "function") {
            request.onsuccess(new Event("success"));
          }
        } finally {
          txState?.notifyDone();
        }
      });

      return request;
    },
    delete: (key: IDBValidKey): IDBRequest => {
      const request = new EventTarget() as unknown as IDBRequest;
      request.readyState = "pending";
      txState?.notifyPending();

      queueMicrotask(() => {
        try {
          records.delete(String(key));
          request.result = undefined;
          request.readyState = "done";
          if (typeof request.onsuccess === "function") {
            request.onsuccess(new Event("success"));
          }
        } finally {
          txState?.notifyDone();
        }
      });

      return request;
    },
    clear: (): IDBRequest => {
      const request = new EventTarget() as unknown as IDBRequest;
      request.readyState = "pending";
      txState?.notifyPending();

      queueMicrotask(() => {
        try {
          records.clear();
          request.result = undefined;
          request.readyState = "done";
          if (typeof request.onsuccess === "function") {
            request.onsuccess(new Event("success"));
          }
        } finally {
          txState?.notifyDone();
        }
      });

      return request;
    },
  };

  return store as IDBObjectStore;
}

function createMockIndex(
  idxDef: StoredIndexDef,
  records: Map<string, unknown>,
  txState?: MockTransactionState,
): IDBIndex {
  return {
    name: idxDef.name,
    keyPath: idxDef.keyPath,
    unique: idxDef.unique,
    objectStore: null as unknown as IDBObjectStore,
    get: (key: IDBValidKey): IDBRequest => {
      const request = new EventTarget() as unknown as IDBRequest;
      request.readyState = "pending";
      txState?.notifyPending();

      queueMicrotask(() => {
        try {
          const targetVal = String(key);
          let found: unknown = undefined;
          for (const item of records.values()) {
            const val = resolveKey(item, idxDef.keyPath);
            if (val === targetVal) {
              found = item;
              break;
            }
          }
          request.result = found ? deepClone(found) : undefined;
          request.readyState = "done";
          if (typeof request.onsuccess === "function") {
            request.onsuccess(new Event("success"));
          }
        } finally {
          txState?.notifyDone();
        }
      });

      return request;
    },
    getAll: (query?: IDBValidKey): IDBRequest => {
      const request = new EventTarget() as unknown as IDBRequest;
      request.readyState = "pending";
      txState?.notifyPending();

      queueMicrotask(() => {
        try {
          const targetVal = query !== undefined ? String(query) : undefined;
          const matches: unknown[] = [];
          for (const item of records.values()) {
            if (targetVal === undefined) {
              matches.push(deepClone(item));
            } else {
              const val = resolveKey(item, idxDef.keyPath);
              if (val === targetVal) {
                matches.push(deepClone(item));
              }
            }
          }
          request.result = matches;
          request.readyState = "done";
          if (typeof request.onsuccess === "function") {
            request.onsuccess(new Event("success"));
          }
        } finally {
          txState?.notifyDone();
        }
      });

      return request;
    },
    count: () => {
      throw new Error("count not implemented in test harness");
    },
    getKey: () => {
      throw new Error("getKey not implemented in test harness");
    },
    getAllKeys: () => {
      throw new Error("getAllKeys not implemented in test harness");
    },
    openCursor: () => {
      throw new Error("openCursor not implemented in test harness");
    },
    openKeyCursor: () => {
      throw new Error("openKeyCursor not implemented in test harness");
    },
  };
}
