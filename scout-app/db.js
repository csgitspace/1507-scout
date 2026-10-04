// ==============================================================================
// On-device storage (IndexedDB). Two stores:
//   kv       small settings: config, schedule, current scout, draft, cursor...
//   records  every submitted match record, forever.
//
// There is deliberately NO function to delete or edit a record. iPad records
// are the backup if the laptop fails (CLAUDE.md -> Constraints). Corrections
// are new records that supersede old ones at the laptop.
// ==============================================================================

const DB_NAME = 'warlocks-scout';
const DB_VERSION = 1;

let dbPromise;
function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('kv');
        db.createObjectStore('records', { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const getSetting = (key) => run('kv', 'readonly', s => s.get(key));
export const setSetting = (key, value) => run('kv', 'readwrite', s => s.put(value, key));
export const clearSetting = (key) => run('kv', 'readwrite', s => s.delete(key));

/** Saves a submitted record; resolves with its new id. */
export const addRecord = (record) => run('records', 'readwrite', s => s.add(record));

/** All records, oldest first. */
export const allRecords = () => run('records', 'readonly', s => s.getAll());

/** Ask iOS not to evict our data under storage pressure. Resolves true if granted. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch { /* not supported */ }
  return false;
}

export async function isPersisted() {
  try {
    if (navigator.storage && navigator.storage.persisted) return await navigator.storage.persisted();
  } catch { /* not supported */ }
  return false;
}
