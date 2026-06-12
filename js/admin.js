(function () {
  "use strict";

  const state = {
    books: [],
    isBusy: false
  };

  const elements = {};

  document.addEventListener("DOMContentLoaded", initializeAdmin);

  async function initializeAdmin() {
    cacheElements();
    bindEvents();

    const user = await window.BookAuth.requireAuth(["admin"]);
    if (!user) {
      return;
    }

    await refreshBooks();
    setStatus(elements.uploadStatus, "Admin area ready.", "success");
  }

  function cacheElements() {
    elements.bookUpload = document.getElementById("bookUpload");
    elements.uploadButton = document.getElementById("uploadButton");
    elements.uploadStatus = document.getElementById("uploadStatus");
    elements.bookCount = document.getElementById("bookCount");
    elements.chunkCount = document.getElementById("chunkCount");
    elements.latestBook = document.getElementById("latestBook");
    elements.selectedFiles = document.getElementById("selectedFiles");
    elements.bookList = document.getElementById("bookList");
    elements.libraryEmpty = document.getElementById("libraryEmpty");
    elements.clearDatabaseButton = document.getElementById("clearDatabaseButton");
    elements.dropZone = document.getElementById("dropZone");
    elements.logoutButton = document.getElementById("logoutButton");
  }

  function bindEvents() {
    elements.uploadButton.addEventListener("click", handleUpload);
    elements.bookUpload.addEventListener("change", renderSelectedFiles);
    elements.clearDatabaseButton.addEventListener("click", handleClearDatabase);
    elements.bookList.addEventListener("click", handleBookListClick);
    elements.logoutButton.addEventListener("click", window.BookAuth.logOutUser);

    elements.dropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      elements.dropZone.classList.add("is-dragging");
    });

    elements.dropZone.addEventListener("dragleave", () => {
      elements.dropZone.classList.remove("is-dragging");
    });

    elements.dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove("is-dragging");
      elements.bookUpload.files = event.dataTransfer.files;
      renderSelectedFiles();
    });
  }

  async function handleUpload() {
    const files = Array.from(elements.bookUpload.files || []);

    if (files.length === 0) {
      setStatus(elements.uploadStatus, "Select at least one PDF.", "warning");
      return;
    }

    if (files.some((file) => !isPdf(file))) {
      setStatus(elements.uploadStatus, "Only PDF files can be uploaded.", "error");
      return;
    }

    setBusy(true);

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setStatus(elements.uploadStatus, loadingText(`Extracting ${file.name} (${index + 1}/${files.length})`));
        const extracted = await window.BookPdf.extractBookFromPdf(file);
        await window.BookBotDB.saveBook(extracted.book, extracted.chunks);
      }

      elements.bookUpload.value = "";
      renderSelectedFiles();
      await refreshBooks();
      setStatus(elements.uploadStatus, "Books uploaded to the user library.", "success");
    } catch (error) {
      setStatus(elements.uploadStatus, error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleBookListClick(event) {
    const button = event.target.closest("[data-delete-book]");

    if (!button) {
      return;
    }

    const bookId = button.getAttribute("data-delete-book");
    const book = state.books.find((item) => item.bookId === bookId);

    if (!book || !confirm(`Delete "${book.bookName}" from the library?`)) {
      return;
    }

    setBusy(true);

    try {
      await window.BookBotDB.deleteBook(bookId);
      await refreshBooks();
      setStatus(elements.uploadStatus, "Book deleted.", "success");
    } catch (error) {
      setStatus(elements.uploadStatus, error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleClearDatabase() {
    if (!confirm("Clear all uploaded books and extracted chunks?")) {
      return;
    }

    setBusy(true);

    try {
      await window.BookBotDB.clearDatabase();
      await refreshBooks();
      setStatus(elements.uploadStatus, "Book database cleared.", "success");
    } catch (error) {
      setStatus(elements.uploadStatus, error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function refreshBooks() {
    state.books = await window.BookBotDB.getBooks();
    elements.bookCount.textContent = formatBookCount(state.books.length);
    elements.chunkCount.textContent = formatNumber(sumChunks(state.books));
    elements.latestBook.textContent = getLatestBookLabel(state.books);
    elements.libraryEmpty.classList.toggle("hidden", state.books.length > 0);
    elements.bookList.innerHTML = "";

    state.books.forEach((book, index) => {
      const item = document.createElement("li");
      item.className = "admin-table-row";
      item.innerHTML = `
        <div class="admin-book-cell admin-book-title-cell">
          <span class="admin-book-index"></span>
          <div>
            <p class="book-name"></p>
            <div class="book-meta">Ready for reader search</div>
          </div>
        </div>
        <div class="admin-book-cell">
          <span class="admin-row-label">Pages</span>
          <strong class="admin-page-count"></strong>
        </div>
        <div class="admin-book-cell">
          <span class="admin-row-label">Chunks</span>
          <strong class="admin-chunk-count"></strong>
        </div>
        <div class="admin-book-cell">
          <span class="admin-row-label">Uploaded</span>
          <strong class="admin-book-date"></strong>
        </div>
        <div class="admin-book-cell admin-book-actions">
          <button class="delete-book" type="button" data-delete-book="">Delete</button>
        </div>
      `;

      item.querySelector(".admin-book-index").textContent = String(index + 1).padStart(2, "0");
      item.querySelector(".book-name").textContent = book.bookName;
      item.querySelector(".admin-page-count").textContent = book.pageCount || 0;
      item.querySelector(".admin-chunk-count").textContent = book.chunkCount || 0;
      item.querySelector(".admin-book-date").textContent = formatDate(book.createdAt);
      item.querySelector("[data-delete-book]").setAttribute("data-delete-book", book.bookId);
      elements.bookList.appendChild(item);
    });
  }

  function renderSelectedFiles() {
    const files = Array.from(elements.bookUpload.files || []);

    if (files.length === 0) {
      elements.selectedFiles.textContent = "No files selected.";
      return;
    }

    elements.selectedFiles.innerHTML = "";
    files.forEach((file) => {
      const item = document.createElement("span");
      item.className = "selected-file-pill";
      item.textContent = file.name;
      elements.selectedFiles.appendChild(item);
    });
  }

  function setBusy(isBusy) {
    state.isBusy = isBusy;
    elements.uploadButton.disabled = isBusy;
    elements.clearDatabaseButton.disabled = isBusy;
    elements.bookUpload.disabled = isBusy;
    elements.bookList.querySelectorAll("button").forEach((button) => {
      button.disabled = isBusy;
    });
  }

  function setStatus(element, value, tone) {
    element.className = "status-line";
    if (tone) {
      element.classList.add(tone);
    }
    if (value && typeof value === "object" && value.nodeType) {
      element.replaceChildren(value);
      return;
    }
    element.textContent = value || "";
  }

  function loadingText(text) {
    const loader = document.createElement("span");
    loader.className = "loader";
    loader.textContent = text;
    return loader;
  }

  function formatBookCount(count) {
    return `${count} book${count === 1 ? "" : "s"}`;
  }

  function sumChunks(books) {
    return books.reduce((total, book) => total + (Number(book.chunkCount) || 0), 0);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat().format(value || 0);
  }

  function getLatestBookLabel(books) {
    if (books.length === 0) {
      return "None yet";
    }

    return books[books.length - 1].bookName.replace(/\.pdf$/i, "");
  }

  function formatDate(value) {
    if (!value) {
      return "";
    }

    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric"
    }).format(new Date(value));
  }

  function isPdf(file) {
    return file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name));
  }
})();
