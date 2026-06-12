(function () {
  "use strict";

  const NOT_FOUND = "Information not found in the uploaded books.";

  const state = {
    book: null,
    chunks: [],
    currentPdf: null,
    currentPage: 1,
    resizeTimer: null,
    isBusy: false
  };

  const elements = {};

  document.addEventListener("DOMContentLoaded", initializeBookPage);

  async function initializeBookPage() {
    cacheElements();
    bindEvents();

    const user = await window.BookAuth.requireAuth(["reader", "admin"]);
    if (!user) {
      return;
    }

    elements.adminLink.classList.toggle("hidden", user.role !== "admin");
    elements.libraryLink.href = user.role === "admin" ? "library.html?from=admin" : "library.html";

    try {
      await loadBook();
    } catch (error) {
      setStatus(elements.readerStatus, error.message, "error");
    }
  }

  function cacheElements() {
    elements.adminLink = document.getElementById("adminLink");
    elements.libraryLink = document.getElementById("libraryLink");
    elements.logoutButton = document.getElementById("logoutButton");
    elements.bookTitle = document.getElementById("bookTitle");
    elements.bookSubtitle = document.getElementById("bookSubtitle");
    elements.readModeButton = document.getElementById("readModeButton");
    elements.chatModeButton = document.getElementById("chatModeButton");
    elements.readerPanel = document.getElementById("readerPanel");
    elements.chatPanel = document.getElementById("chatPanel");
    elements.evidencePanel = document.getElementById("evidencePanel");
    elements.previousPageButton = document.getElementById("previousPageButton");
    elements.nextPageButton = document.getElementById("nextPageButton");
    elements.pageIndicator = document.getElementById("pageIndicator");
    elements.readerStatus = document.getElementById("readerStatus");
    elements.pdfSpread = document.getElementById("pdfSpread");
    elements.leftPdfCanvas = document.getElementById("leftPdfCanvas");
    elements.rightPdfCanvas = document.getElementById("rightPdfCanvas");
    elements.readerTextSpread = document.getElementById("readerTextSpread");
    elements.leftReaderText = document.getElementById("leftReaderText");
    elements.rightReaderText = document.getElementById("rightReaderText");
    elements.chatForm = document.getElementById("chatForm");
    elements.questionInput = document.getElementById("questionInput");
    elements.askButton = document.getElementById("askButton");
    elements.clearChatButton = document.getElementById("clearChatButton");
    elements.chatStatus = document.getElementById("chatStatus");
    elements.chatThread = document.getElementById("chatThread");
    elements.evidenceEmpty = document.getElementById("evidenceEmpty");
    elements.evidenceStack = document.getElementById("evidenceStack");
  }

  function bindEvents() {
    elements.logoutButton.addEventListener("click", window.BookAuth.logOutUser);
    elements.readModeButton.addEventListener("click", () => setBookMode("read"));
    elements.chatModeButton.addEventListener("click", () => setBookMode("chat"));
    elements.previousPageButton.addEventListener("click", () => changePage(-1));
    elements.nextPageButton.addEventListener("click", () => changePage(1));
    elements.chatForm.addEventListener("submit", handleQuestionSubmit);
    elements.questionInput.addEventListener("input", () => setStatus(elements.chatStatus, ""));
    elements.questionInput.addEventListener("keydown", handleQuestionKeydown);
    elements.clearChatButton.addEventListener("click", resetChat);
    elements.chatThread.addEventListener("click", handlePromptChipClick);
    window.addEventListener("resize", handleReaderResize);
  }

  async function loadBook() {
    const params = new URLSearchParams(window.location.search);
    const bookId = params.get("id");

    if (!bookId) {
      throw new Error("No book selected. Return to the library and open a book.");
    }

    setBusy(true);
    setStatus(elements.readerStatus, loadingText("Loading book"));

    try {
      const book = await window.BookBotDB.getBook(bookId);

      if (!book) {
        throw new Error("Book was not found.");
      }

      state.book = book;
      state.chunks = await window.BookBotDB.getBookChunks(bookId);
      state.currentPage = 1;
      state.currentPdf = null;

    elements.bookTitle.textContent = book.bookName;
    elements.bookSubtitle.textContent = `${book.pageCount || 0} pages, ${book.chunkCount || state.chunks.length} chunks`;

      resetChat();
      await loadReader();
      setBookMode("read");
    } finally {
      setBusy(false);
    }
  }

  function handleQuestionKeydown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.chatForm.requestSubmit();
    }
  }

  function handlePromptChipClick(event) {
    const chip = event.target.closest("[data-question]");

    if (!chip) {
      return;
    }

    elements.questionInput.value = chip.getAttribute("data-question");
    elements.chatForm.requestSubmit();
  }

  async function loadReader() {
    if (!state.book) {
      return;
    }

    if (state.book.pdfBlob && window.pdfjsLib) {
      try {
        const arrayBuffer = await state.book.pdfBlob.arrayBuffer();
        state.currentPdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        await renderPdfPage();
        setStatus(elements.readerStatus, "PDF loaded.", "success");
        return;
      } catch (error) {
        state.currentPdf = null;
        setStatus(elements.readerStatus, "PDF preview failed. Showing extracted text instead.", "warning");
      }
    }

    renderTextPage();
  }

  async function renderPdfPage() {
    if (!state.currentPdf) {
      renderTextPage();
      return;
    }

    const pageNumbers = getVisiblePageNumbers();
    const firstPage = await state.currentPdf.getPage(pageNumbers[0]);
    const baseViewport = firstPage.getViewport({ scale: 1 });
    const stageWidth = Math.max(320, elements.pdfSpread.parentElement.clientWidth - 42);
    const spreadGap = 18;
    const isStackedSpread = stageWidth < 760;
    const pageSlotWidth = pageNumbers.length > 1 && !isStackedSpread ? (stageWidth - spreadGap) / 2 : stageWidth;
    const scale = Math.max(0.2, Math.min(1.45, pageSlotWidth / baseViewport.width));

    elements.pdfSpread.style.display = "flex";
    elements.readerTextSpread.style.display = "none";
    elements.rightPdfCanvas.classList.toggle("hidden", pageNumbers.length === 1);

    await renderPdfCanvas(firstPage, elements.leftPdfCanvas, scale);

    if (pageNumbers.length > 1) {
      const secondPage = await state.currentPdf.getPage(pageNumbers[1]);
      await renderPdfCanvas(secondPage, elements.rightPdfCanvas, scale);
    } else {
      clearCanvas(elements.rightPdfCanvas);
    }

    updateReaderControls();
  }

  async function renderPdfCanvas(page, canvas, scale) {
    const viewport = page.getViewport({ scale });
    const outputScale = Math.min(window.devicePixelRatio || 1, 2.5);
    const context = canvas.getContext("2d");

    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    canvas.style.display = "block";

    await page.render({
      canvasContext: context,
      viewport,
      transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null
    }).promise;
  }

  function clearCanvas(canvas) {
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    canvas.removeAttribute("style");
  }

  function renderTextPage() {
    const pageNumbers = getVisiblePageNumbers();
    const leftPageText = getPageText(pageNumbers[0]);
    const rightPageText = pageNumbers.length > 1 ? getPageText(pageNumbers[1]) : "";

    elements.pdfSpread.style.display = "none";
    elements.readerTextSpread.style.display = "grid";
    elements.leftReaderText.textContent = leftPageText || "No extractable text found for this page.";
    elements.rightReaderText.textContent = rightPageText || "";
    elements.rightReaderText.classList.toggle("hidden", pageNumbers.length === 1);
    updateReaderControls();

    if (!state.book.pdfBlob) {
      setStatus(elements.readerStatus, "Showing extracted text. Re-upload this book to enable PDF preview.", "warning");
    }
  }

  async function changePage(delta) {
    if (!state.book) {
      return;
    }

    const maxPage = getPageCount();
    const nextPage = state.currentPage + (delta * 2);
    state.currentPage = Math.min(getLastSpreadStart(maxPage), Math.max(1, nextPage));

    if (state.currentPdf) {
      setStatus(elements.readerStatus, loadingText("Rendering page"));
      await renderPdfPage();
      setStatus(elements.readerStatus, "PDF loaded.", "success");
    } else {
      renderTextPage();
    }
  }

  async function handleQuestionSubmit(event) {
    event.preventDefault();

    const question = elements.questionInput.value.trim();

    if (!question) {
      setStatus(elements.chatStatus, "Enter a question.", "warning");
      return;
    }

    if (!state.book) {
      setStatus(elements.chatStatus, "Open a book first.", "warning");
      return;
    }

    setBusy(true);
    setStatus(elements.chatStatus, "");
    removeInitialChatEmptyState();
    appendUserMessage(question);

    try {
      if (isSocialMessage(question)) {
        appendAnswerMessage("Hi. Ask me anything about this book, and I will answer only from its pages.", []);
        clearEvidence();
        elements.questionInput.value = "";
        return;
      }

      setStatus(elements.chatStatus, loadingText(`Searching ${state.book.bookName}`));
      const context = await window.BookBotDB.searchBookChunks(state.book.bookId, question, 6);
      const result = await window.answerQuestion(question, context);

      appendAnswerMessage(result.answer, result.sources);
      renderEvidence(result.sources);
      elements.questionInput.value = "";
      setStatus(elements.chatStatus, "Answer ready.", "success");
    } catch (error) {
      appendAnswerMessage(NOT_FOUND, []);
      clearEvidence();
      setStatus(elements.chatStatus, error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function setBookMode(mode) {
    elements.readModeButton.classList.toggle("active", mode === "read");
    elements.chatModeButton.classList.toggle("active", mode === "chat");
    elements.readerPanel.parentElement.classList.toggle("reading-layout", mode === "read");
    elements.readerPanel.classList.toggle("active", mode === "read");
    elements.chatPanel.classList.toggle("active", mode === "chat");
    elements.evidencePanel.classList.toggle("active", mode === "chat");

    if (mode === "read") {
      handleReaderResize();
    }
  }

  function handleReaderResize() {
    if (!state.currentPdf || !elements.readerPanel.classList.contains("active")) {
      return;
    }

    clearTimeout(state.resizeTimer);
    state.resizeTimer = setTimeout(async () => {
      try {
        await renderPdfPage();
      } catch (error) {
        setStatus(elements.readerStatus, "Could not resize the PDF page.", "warning");
      }
    }, 160);
  }

  function appendUserMessage(question) {
    const message = document.createElement("article");
    message.className = "message user";
    message.innerHTML = `
      <p class="message-label">User Question</p>
      <p class="message-text"></p>
    `;
    message.querySelector(".message-text").textContent = question;
    elements.chatThread.appendChild(message);
    scrollChatToBottom();
  }

  function appendAnswerMessage(answer, sources) {
    const message = document.createElement("article");
    message.className = "message answer";
    message.innerHTML = `
      <p class="message-label">Answer</p>
      <p class="message-text"></p>
      <div class="sources"></div>
    `;

    message.querySelector(".message-text").textContent = answer;
    const sourceStack = message.querySelector(".sources");

    if (sources && sources.length > 0 && answer !== NOT_FOUND) {
      sources.forEach((source) => sourceStack.appendChild(createSourceCard(source)));
    } else {
      sourceStack.remove();
    }

    elements.chatThread.appendChild(message);
    scrollChatToBottom();
  }

  function createSourceCard(source) {
    const card = document.createElement("div");
    card.className = "source-card";
    card.innerHTML = `
      <p class="source-title"></p>
      <div class="source-meta"></div>
      <p class="source-excerpt"></p>
    `;

    card.querySelector(".source-title").textContent = source.bookName;
    card.querySelector(".source-meta").textContent = `Page ${source.pageNumber}`;
    card.querySelector(".source-excerpt").textContent = source.excerpt;

    return card;
  }

  function renderEvidence(sources) {
    elements.evidenceStack.innerHTML = "";
    elements.evidenceEmpty.classList.toggle("hidden", sources && sources.length > 0);

    (sources || []).forEach((source, index) => {
      const details = document.createElement("details");
      details.className = "evidence-item";
      details.innerHTML = `
        <summary></summary>
        <div class="evidence-body">
          <div class="evidence-meta"></div>
          <p class="evidence-text"></p>
        </div>
      `;

      details.querySelector("summary").textContent = `Show Evidence ${index + 1}`;
      details.querySelector(".evidence-meta").textContent = `${source.bookName} - Page ${source.pageNumber}`;
      details.querySelector(".evidence-text").textContent = source.chunkText;
      elements.evidenceStack.appendChild(details);
    });
  }

  function clearEvidence() {
    elements.evidenceStack.innerHTML = "";
    elements.evidenceEmpty.classList.remove("hidden");
  }

  function resetChat() {
    elements.chatThread.innerHTML = `
      <article class="chat-empty">
        <p class="chat-empty-title">Ask from the pages, not the internet.</p>
        <p class="chat-empty-copy">BookBot searches this selected book, answers only from matching passages, and shows evidence when it finds support.</p>
        <div class="prompt-chips" aria-label="Suggested questions">
          <button type="button" data-question="Summarize the main idea of this book.">Summarize</button>
          <button type="button" data-question="What are the most important points in this book?">Key points</button>
          <button type="button" data-question="What does this book say about the main topic?">Main topic</button>
        </div>
      </article>
    `;
    elements.questionInput.value = "";
    setStatus(elements.chatStatus, "");
    clearEvidence();
  }

  function removeInitialChatEmptyState() {
    const empty = elements.chatThread.querySelector(".chat-empty, .empty-state");
    if (empty && elements.chatThread.children.length === 1) {
      empty.remove();
    }
  }

  function isSocialMessage(value) {
    const normalized = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[!?.\s]+$/g, "");

    return [
      "hi",
      "hello",
      "hey",
      "thanks",
      "thank you",
      "ok",
      "okay"
    ].includes(normalized);
  }

  function updateReaderControls() {
    const maxPage = getPageCount();

    const pageNumbers = getVisiblePageNumbers();
    elements.pageIndicator.textContent = pageNumbers.length > 1
      ? `Pages ${pageNumbers[0]}-${pageNumbers[1]} of ${maxPage}`
      : `Page ${pageNumbers[0]} of ${maxPage}`;
    elements.previousPageButton.disabled = state.isBusy || state.currentPage <= 1;
    elements.nextPageButton.disabled = state.isBusy || state.currentPage >= getLastSpreadStart(maxPage);
  }

  function getPageCount() {
    if (state.currentPdf) {
      return state.currentPdf.numPages;
    }

    return Math.max(1, Number(state.book && state.book.pageCount) || 1);
  }

  function getVisiblePageNumbers() {
    const maxPage = getPageCount();
    const firstPage = Math.min(state.currentPage, maxPage);
    const pages = [firstPage];

    if (firstPage + 1 <= maxPage) {
      pages.push(firstPage + 1);
    }

    return pages;
  }

  function getLastSpreadStart(maxPage) {
    return Math.max(1, maxPage % 2 === 0 ? maxPage - 1 : maxPage);
  }

  function getPageText(pageNumber) {
    if (state.book && Array.isArray(state.book.pages)) {
      const page = state.book.pages.find((item) => item.pageNumber === pageNumber);
      if (page && page.text) {
        return page.text;
      }
    }

    return state.chunks
      .filter((chunk) => chunk.pageNumber === pageNumber)
      .map((chunk) => chunk.chunkText)
      .join("\n\n");
  }

  function setBusy(isBusy) {
    state.isBusy = isBusy;
    elements.askButton.disabled = isBusy;
    elements.clearChatButton.disabled = isBusy;
    updateReaderControls();
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

  function scrollChatToBottom() {
    elements.chatThread.scrollTop = elements.chatThread.scrollHeight;
  }
})();
