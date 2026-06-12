(function () {
  "use strict";

  const PDF_WORKER_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const MIN_CHUNK_LENGTH = 500;
  const MAX_CHUNK_LENGTH = 950;

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
  }

  async function extractBookFromPdf(file) {
    if (!window.pdfjsLib) {
      throw new Error("PDF.js is not available. Check your internet connection and reload the page.");
    }

    if (!file || (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name))) {
      throw new Error("Only PDF files can be uploaded.");
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
    const bookId = createId();
    const chunks = [];
    const pages = [];
    let extractedCharacters = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = normalizePageText(textContent.items);

      extractedCharacters += pageText.length;
      pages.push({ pageNumber, text: pageText });

      splitIntoChunks(pageText).forEach((chunkText, chunkIndex) => {
        chunks.push({
          chunkId: `${bookId}-${pageNumber}-${chunkIndex + 1}`,
          bookId,
          bookName: file.name,
          pageNumber,
          chunkText,
          createdAt: new Date().toISOString()
        });
      });
    }

    if (extractedCharacters === 0 || chunks.length === 0) {
      throw new Error(`${file.name} does not contain extractable text. Scanned PDFs need OCR before upload.`);
    }

    const book = {
      bookId,
      bookName: file.name,
      pageCount: pdf.numPages,
      chunkCount: chunks.length,
      pages,
      pdfBlob: new Blob([arrayBuffer], { type: "application/pdf" }),
      createdAt: new Date().toISOString()
    };

    return { book, chunks };
  }

  function normalizePageText(items) {
    return items
      .map((item) => {
        const value = item.str || "";
        return item.hasEOL ? `${value}\n` : value;
      })
      .join(" ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  function splitIntoChunks(text) {
    const cleanText = String(text || "").replace(/\s+/g, " ").trim();

    if (!cleanText) {
      return [];
    }

    if (cleanText.length <= MAX_CHUNK_LENGTH) {
      return [cleanText];
    }

    const sentences = cleanText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [cleanText];
    const chunks = [];
    let current = "";

    sentences.forEach((sentence) => {
      const cleanSentence = sentence.trim();

      if (!cleanSentence) {
        return;
      }

      if (cleanSentence.length > MAX_CHUNK_LENGTH) {
        flushCurrent(chunks, current);
        current = "";
        splitLongSentence(cleanSentence).forEach((part) => chunks.push(part));
        return;
      }

      const next = current ? `${current} ${cleanSentence}` : cleanSentence;

      if (next.length > MAX_CHUNK_LENGTH && current.length >= MIN_CHUNK_LENGTH) {
        chunks.push(current);
        current = cleanSentence;
      } else if (next.length > MAX_CHUNK_LENGTH) {
        chunks.push(next.slice(0, MAX_CHUNK_LENGTH).trim());
        current = next.slice(MAX_CHUNK_LENGTH).trim();
      } else {
        current = next;
      }
    });

    flushCurrent(chunks, current);
    return chunks.filter(Boolean);
  }

  function splitLongSentence(sentence) {
    const words = sentence.split(/\s+/);
    const chunks = [];
    let current = "";

    words.forEach((word) => {
      const next = current ? `${current} ${word}` : word;

      if (next.length > MAX_CHUNK_LENGTH) {
        flushCurrent(chunks, current);
        current = word;
      } else {
        current = next;
      }
    });

    flushCurrent(chunks, current);
    return chunks;
  }

  function flushCurrent(chunks, value) {
    const cleanValue = String(value || "").trim();
    if (cleanValue) {
      chunks.push(cleanValue);
    }
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    return `book-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  window.BookPdf = {
    extractBookFromPdf,
    splitIntoChunks
  };
})();
