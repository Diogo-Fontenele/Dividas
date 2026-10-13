/* Banco de dados local (IndexedDB) — tudo fica no celular. */
(function () {
  'use strict';
  const NAME = 'planejamento-familiar', VERSION = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('dividas')) db.createObjectStore('dividas', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('rendas')) db.createObjectStore('rendas', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('config')) db.createObjectStore('config', { keyPath: 'chave' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function run(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const st = tx.objectStore(store);
      const r = fn(st);
      tx.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  window.DB = {
    open,
    all: (store) => run(store, 'readonly', (s) => s.getAll()),
    put: (store, obj) => run(store, 'readwrite', (s) => s.put(obj)),
    del: (store, id) => run(store, 'readwrite', (s) => s.delete(id)),
    clear: (store) => run(store, 'readwrite', (s) => s.clear()),
    async getConfig() {
      const rows = await this.all('config');
      const cfg = {};
      rows.forEach((r) => (cfg[r.chave] = r.valor));
      return cfg;
    },
    setConfig: (chave, valor) => run('config', 'readwrite', (s) => s.put({ chave, valor })),
  };
})();
