import { Book } from '../types';
import { TOKENIZER_VERSION, migratePosition } from './tokenize';

// Books live in IndexedDB: localStorage caps out around 5-10 MB, which a few novels exceed.
const DB_NAME = 'rsvp_reader';
const STORE = 'books';
const LEGACY_KEY = 'quest_rsvp_books';

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
  });
};

export const loadBooks = async (): Promise<Book[]> => {
  const books = ((await tx('readonly', s => s.getAll())) as Book[] | undefined) ?? [];
  // One-time migration from the old localStorage format.
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy) {
    try {
      const old = JSON.parse(legacy) as Book[];
      await tx('readwrite', s => { old.forEach(b => s.put(b)); });
      localStorage.removeItem(LEGACY_KEY);
      const ids = new Set(books.map(b => b.id));
      books.push(...old.filter(b => !ids.has(b.id)));
    } catch (e) {
      console.error('Legacy book migration failed', e);
    }
  }
  // Positions saved before hyphenated words were split need re-indexing.
  const migrated = books.map(b => b.tokenizer === TOKENIZER_VERSION ? b
    : { ...b, lastPosition: migratePosition(b.content, b.lastPosition), tokenizer: TOKENIZER_VERSION });
  const changed = migrated.filter((b, i) => b !== books[i]);
  if (changed.length) await tx('readwrite', s => { changed.forEach(b => s.put(b)); });
  return migrated.sort((a, b) => b.addedAt - a.addedAt);
};

export const saveBook = (book: Book) => tx('readwrite', s => { s.put(book); });
export const deleteBook = (id: string) => tx('readwrite', s => { s.delete(id); });
