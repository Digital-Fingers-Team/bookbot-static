(function () {
  "use strict";

  let currentUser = null;
  const elements = {};

  document.addEventListener("DOMContentLoaded", initializeLibrary);

  async function initializeLibrary() {
    cacheElements();
    bindEvents();

    currentUser = await window.BookAuth.requireAuth(["reader", "admin"]);
    if (!currentUser) {
      return;
    }

    elements.adminLink.classList.toggle("hidden", currentUser.role !== "admin");
    await renderLibrary();
  }

  function cacheElements() {
    elements.bookCount = document.getElementById("bookCount");
    elements.libraryGrid = document.getElementById("libraryGrid");
    elements.libraryEmpty = document.getElementById("libraryEmpty");
    elements.logoutButton = document.getElementById("logoutButton");
    elements.adminLink = document.getElementById("adminLink");
  }

  function bindEvents() {
    elements.logoutButton.addEventListener("click", window.BookAuth.logOutUser);
    elements.libraryGrid.addEventListener("click", (event) => {
      const card = event.target.closest("[data-open-book]");
      if (card) {
        const adminSource = currentUser && currentUser.role === "admin" ? "&from=admin" : "";
        window.location.href = `book.html?id=${encodeURIComponent(card.getAttribute("data-open-book"))}${adminSource}`;
      }
    });
    elements.libraryGrid.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      const card = event.target.closest("[data-open-book]");
      if (card) {
        event.preventDefault();
        card.click();
      }
    });
  }

  async function renderLibrary() {
    const books = await window.BookBotDB.getBooks();

    elements.bookCount.textContent = formatBookCount(books.length);
    elements.libraryEmpty.classList.toggle("hidden", books.length > 0);
    elements.libraryGrid.innerHTML = "";

    books.forEach((book) => {
      const card = document.createElement("article");
      card.className = "book-card";
      card.tabIndex = 0;
      card.setAttribute("role", "link");
      card.setAttribute("data-open-book", book.bookId);
      card.setAttribute("aria-label", `Open ${book.bookName}`);
      card.innerHTML = `
        <div class="book-cover" aria-hidden="true"></div>
        <div>
          <p class="book-card-title"></p>
          <p class="book-meta"></p>
        </div>
      `;

      card.querySelector(".book-cover").textContent = getInitials(book.bookName);
      card.querySelector(".book-card-title").textContent = book.bookName;
      card.querySelector(".book-meta").textContent = `${book.pageCount || 0} pages, ${book.chunkCount || 0} chunks`;
      elements.libraryGrid.appendChild(card);
      renderBookThumbnail(book.bookId, card.querySelector(".book-cover"));
    });
  }

  async function renderBookThumbnail(bookId, coverElement) {
    if (!window.pdfjsLib) {
      return;
    }

    try {
      const book = await window.BookBotDB.getBook(bookId);
      if (!book || !book.pdfBlob) {
        return;
      }

      const arrayBuffer = await book.pdfBlob.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);
      const baseViewport = page.getViewport({ scale: 1 });
      const targetWidth = 220;
      const scale = targetWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      await page.render({
        canvasContext: context,
        viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null
      }).promise;

      coverElement.textContent = "";
      coverElement.classList.add("has-thumbnail");
      coverElement.appendChild(canvas);
    } catch (error) {
      coverElement.classList.add("thumbnail-failed");
    }
  }

  function getInitials(name) {
    const words = String(name || "Book")
      .replace(/\.pdf$/i, "")
      .split(/\s+/)
      .filter(Boolean);

    if (words.length === 0) {
      return "BK";
    }

    return words
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join("");
  }

  function formatBookCount(count) {
    return `${count} book${count === 1 ? "" : "s"}`;
  }
})();
