// IndexedDB helper - compartilhado entre popup e background
const DB_NAME = 'GrokAutomatorDB';
const DB_VERSION = 1;

const DB = {
  async openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('images')) {
          db.createObjectStore('images', { keyPath: 'id' });
        }
      };
    });
  },

  async addImages(images) {
    const db = await this.openDB();
    const tx = db.transaction('images', 'readwrite');
    const store = tx.objectStore('images');
    
    for (const img of images) {
      store.put(img);
    }
    
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        console.log(`✅ ${images.length} imagens salvas no IndexedDB`);
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  },

  async getAllImages() {
    const db = await this.openDB();
    const tx = db.transaction('images', 'readonly');
    const store = tx.objectStore('images');
    const request = store.getAll();
    
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async getImage(id) {
    const db = await this.openDB();
    const tx = db.transaction('images', 'readonly');
    const store = tx.objectStore('images');
    const request = store.get(id);
    
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async updateImage(id, updates) {
    const db = await this.openDB();
    const tx = db.transaction('images', 'readwrite');
    const store = tx.objectStore('images');
    
    const img = await new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    
    if (!img) throw new Error(`Image ${id} not found`);
    
    const updated = { ...img, ...updates };
    store.put(updated);
    
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(updated);
      tx.onerror = () => reject(tx.error);
    });
  },

  async deleteImage(id) {
    const db = await this.openDB();
    const tx = db.transaction('images', 'readwrite');
    const store = tx.objectStore('images');
    store.delete(id);
    
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async clearAll() {
    const db = await this.openDB();
    const tx = db.transaction('images', 'readwrite');
    const store = tx.objectStore('images');
    store.clear();
    
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        console.log('✅ IndexedDB limpo');
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }
};
