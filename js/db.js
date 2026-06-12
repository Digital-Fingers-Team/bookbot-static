(function () {
  "use strict";

  const DB_NAME = "BookBotDB";
  const DB_VERSION = 3;
  const BOOK_STORE = "books";
  const CHUNK_STORE = "chunks";
  const USER_STORE = "users";

  let dbPromise = null;

  function initDB() {
    if (dbPromise) {
      return dbPromise;
    }

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(BOOK_STORE)) {
          const books = db.createObjectStore(BOOK_STORE, { keyPath: "bookId" });
          books.createIndex("bookName", "bookName", { unique: false });
          books.createIndex("createdAt", "createdAt", { unique: false });
        }

        if (!db.objectStoreNames.contains(CHUNK_STORE)) {
          const chunks = db.createObjectStore(CHUNK_STORE, { keyPath: "chunkId" });
          chunks.createIndex("bookId", "bookId", { unique: false });
          chunks.createIndex("bookName", "bookName", { unique: false });
          chunks.createIndex("pageNumber", "pageNumber", { unique: false });
        }

        if (!db.objectStoreNames.contains(USER_STORE)) {
          const users = db.createObjectStore(USER_STORE, { keyPath: "userId" });
          users.createIndex("email", "email", { unique: true });
          users.createIndex("role", "role", { unique: false });
          users.createIndex("createdAt", "createdAt", { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Unable to open IndexedDB."));
    });

    return dbPromise;
  }

  async function saveBook(book, chunks) {
    const db = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([BOOK_STORE, CHUNK_STORE], "readwrite");
      const bookStore = transaction.objectStore(BOOK_STORE);
      const chunkStore = transaction.objectStore(CHUNK_STORE);

      bookStore.put(book);
      chunks.forEach((chunk) => chunkStore.put(chunk));

      transaction.oncomplete = () => resolve({ book, chunks });
      transaction.onerror = () => reject(transaction.error || new Error("Book could not be saved."));
      transaction.onabort = () => reject(transaction.error || new Error("Book save was interrupted."));
    });
  }

  async function saveUser(user) {
    const db = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(USER_STORE, "readwrite");
      transaction.objectStore(USER_STORE).add(user);

      transaction.oncomplete = () => resolve(user);
      transaction.onerror = () => {
        if (transaction.error && transaction.error.name === "ConstraintError") {
          reject(new Error("An account with this email already exists."));
          return;
        }
        reject(transaction.error || new Error("Account could not be saved."));
      };
      transaction.onabort = () => reject(transaction.error || new Error("Account save was interrupted."));
    });
  }

  async function getUser(userId) {
    const db = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(USER_STORE, "readonly");
      const request = transaction.objectStore(USER_STORE).get(userId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Account could not be loaded."));
    });
  }

  async function getUserByEmail(email) {
    const db = await initDB();
    const normalizedEmail = String(email || "").trim().toLowerCase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(USER_STORE, "readonly");
      const request = transaction.objectStore(USER_STORE).index("email").get(normalizedEmail);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Account could not be loaded."));
    });
  }

  async function getBooks() {
    const books = await getAllFromStore(BOOK_STORE);
    return books
      .map((book) => ({
        bookId: book.bookId,
        bookName: book.bookName,
        pageCount: book.pageCount,
        chunkCount: book.chunkCount,
        createdAt: book.createdAt,
        hasPdf: Boolean(book.pdfBlob)
      }))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  async function getBook(bookId) {
    const db = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(BOOK_STORE, "readonly");
      const request = transaction.objectStore(BOOK_STORE).get(bookId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Book could not be loaded."));
    });
  }

  async function getAllChunks() {
    return getAllFromStore(CHUNK_STORE);
  }

  async function getBookChunks(bookId) {
    const db = await initDB();

    return new Promise((resolve, reject) => {
      const chunks = [];
      const transaction = db.transaction(CHUNK_STORE, "readonly");
      const index = transaction.objectStore(CHUNK_STORE).index("bookId");
      const request = index.openCursor(IDBKeyRange.only(bookId));

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          chunks.push(cursor.value);
          cursor.continue();
        }
      };

      transaction.oncomplete = () => {
        chunks.sort((a, b) => {
          if (a.pageNumber !== b.pageNumber) {
            return a.pageNumber - b.pageNumber;
          }
          return String(a.chunkId).localeCompare(String(b.chunkId));
        });
        resolve(chunks);
      };
      transaction.onerror = () => reject(transaction.error || new Error("Book chunks could not be loaded."));
      transaction.onabort = () => reject(transaction.error || new Error("Book chunks load was interrupted."));
    });
  }

  async function searchChunks(query, limit) {
    const chunks = await getAllChunks();
    return rank(query, chunks, limit || 6);
  }

  async function searchBookChunks(bookId, query, limit) {
    const chunks = await getBookChunks(bookId);
    return rank(query, chunks, limit || 6);
  }

  async function deleteBook(bookId) {
    const db = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([BOOK_STORE, CHUNK_STORE], "readwrite");
      const bookStore = transaction.objectStore(BOOK_STORE);
      const chunkStore = transaction.objectStore(CHUNK_STORE);
      const bookIndex = chunkStore.index("bookId");

      bookStore.delete(bookId);

      const cursorRequest = bookIndex.openCursor(IDBKeyRange.only(bookId));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Book could not be deleted."));
      transaction.onabort = () => reject(transaction.error || new Error("Book delete was interrupted."));
    });
  }

  async function clearDatabase() {
    const db = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([BOOK_STORE, CHUNK_STORE], "readwrite");
      transaction.objectStore(BOOK_STORE).clear();
      transaction.objectStore(CHUNK_STORE).clear();

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Database could not be cleared."));
      transaction.onabort = () => reject(transaction.error || new Error("Database clear was interrupted."));
    });
  }

  async function getAllFromStore(storeName) {
    const db = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error("Unable to read IndexedDB records."));
    });
  }

  function rank(query, chunks, limit) {
    if (window.BookSearch && typeof window.BookSearch.rankChunks === "function") {
      return window.BookSearch.rankChunks(query, chunks, limit);
    }

    return fallbackRankChunks(query, chunks, limit);
  }

  function fallbackRankChunks(query, chunks, limit) {
    const terms = normalizeTerms(query);

    return chunks
      .map((chunk) => {
        const text = `${chunk.bookName} ${chunk.chunkText}`.toLowerCase();
        const score = terms.reduce((total, term) => total + countMatches(text, term), 0);
        return Object.assign({}, chunk, { score });
      })
      .filter((chunk) => chunk.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  function normalizeTerms(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((term) => term.length > 2);
  }

  function countMatches(text, term) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = text.match(new RegExp(`\\b${escaped}`, "g"));
    return matches ? matches.length : 0;
  }

  window.BookBotDB = {
    initDB,
    saveUser,
    getUser,
    getUserByEmail,
    saveBook,
    getBooks,
    getBook,
    getAllChunks,
    getBookChunks,
    searchChunks,
    searchBookChunks,
    deleteBook,
    clearDatabase
  };
})();
