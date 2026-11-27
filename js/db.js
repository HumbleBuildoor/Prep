// A thin promise wrapper over IndexedDB. Everything the app knows is stored on this device.
//   items   one record per supply item (deleted items are kept as tombstones so a later merge stays correct)
//   events  an append-only log: every change of quantity is an entry with a signed delta
//   photos  item photos as blobs
//   meta    settings, scenarios, device id, API key, last backup time

const NAME = 'prep-db';
const VERSION = 1;
let db = null;

export function openDB() {
  if (db) return Promise.resolve(db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('events')) d.createObjectStore('events', { keyPath: 'id' }).createIndex('itemId', 'itemId');
      if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'id' }).createIndex('itemId', 'itemId');
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    };
    req.onsuccess = () => { db = req.result; db.onversionchange = () => db.close(); resolve(db); };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('The database is open in another tab.'));
  });
}

const wrap = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const store = (name, mode) => db.transaction(name, mode).objectStore(name);

export const all = name => wrap(store(name, 'readonly').getAll());
export const get = (name, key) => wrap(store(name, 'readonly').get(key));
export const byIndex = (name, index, key) => wrap(store(name, 'readonly').index(index).getAll(key));
export const put = (name, value, key) => wrap(key === undefined ? store(name, 'readwrite').put(value) : store(name, 'readwrite').put(value, key));
export const del = (name, key) => wrap(store(name, 'readwrite').delete(key));

/** Writes records to several stores in one transaction. pairs: [[storeName, value], ...] */
export function putAll(pairs) {
  return new Promise((resolve, reject) => {
    if (!pairs.length) return resolve();
    const tx = db.transaction([...new Set(pairs.map(p => p[0]))], 'readwrite');
    for (const [name, value] of pairs) tx.objectStore(name).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('The save was cancelled.'));
  });
}
