(function () {
  "use strict";

  const STOP_WORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "did", "do", "does",
    "for", "from", "had", "has", "have", "how", "in", "into", "is", "it", "its",
    "of", "on", "or", "that", "the", "their", "there", "this", "to", "was", "were",
    "what", "when", "where", "which", "who", "why", "with", "would", "about"
  ]);

  let miniSearch = null;
  let indexedCount = 0;
  let indexedSignature = "";

  function rebuildIndex(chunks) {
    const documents = prepareDocuments(chunks);
    indexedCount = documents.length;
    indexedSignature = createSignature(documents);

    if (!window.MiniSearch) {
      miniSearch = null;
      return;
    }

    miniSearch = new window.MiniSearch({
      fields: ["bookName", "chunkText"],
      storeFields: ["chunkId", "bookId", "bookName", "pageNumber", "chunkText"],
      searchOptions: {
        boost: { chunkText: 3, bookName: 1 },
        fuzzy: 0.18,
        prefix: true
      }
    });

    if (documents.length > 0) {
      miniSearch.addAll(documents);
    }
  }

  function rankChunks(query, chunks, limit) {
    const maxResults = limit || 6;
    const documents = prepareDocuments(chunks);
    const meaningfulTerms = getMeaningfulTerms(query);

    if (!query || !String(query).trim() || documents.length === 0) {
      return [];
    }

    if (!window.MiniSearch) {
      return fallbackRank(query, documents, maxResults);
    }

    if (!miniSearch || indexedCount !== documents.length || indexedSignature !== createSignature(documents)) {
      rebuildIndex(documents);
    }

    const results = miniSearch
      .search(query, {
        boost: { chunkText: 3, bookName: 1 },
        fuzzy: 0.18,
        prefix: true,
        combineWith: "OR"
      })
      .map((result) => {
        const overlap = countTermOverlap(result.chunkText, meaningfulTerms);
        return Object.assign({}, result, { overlap });
      })
      .filter((result) => meaningfulTerms.length === 0 || result.overlap > 0)
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return b.overlap - a.overlap;
      })
      .slice(0, maxResults);

    if (results.length > 0) {
      return results;
    }

    return fallbackRank(query, documents, maxResults);
  }

  function prepareDocuments(chunks) {
    return (chunks || []).map((chunk) => ({
      id: chunk.chunkId,
      chunkId: chunk.chunkId,
      bookId: chunk.bookId,
      bookName: chunk.bookName,
      pageNumber: chunk.pageNumber,
      chunkText: chunk.chunkText
    }));
  }

  function createSignature(documents) {
    return documents.map((document) => document.chunkId).join("|");
  }

  function fallbackRank(query, documents, limit) {
    const terms = getMeaningfulTerms(query);

    return documents
      .map((document) => {
        const text = `${document.bookName} ${document.chunkText}`.toLowerCase();
        const score = terms.reduce((total, term) => total + countMatches(text, term), 0);
        return Object.assign({}, document, { score, overlap: score });
      })
      .filter((document) => document.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  function getMeaningfulTerms(query) {
    return Array.from(new Set(
      String(query || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((term) => term.length > 2 && !STOP_WORDS.has(term))
    ));
  }

  function countTermOverlap(text, terms) {
    const lowerText = String(text || "").toLowerCase();
    return terms.reduce((total, term) => total + (lowerText.includes(term) ? 1 : 0), 0);
  }

  function countMatches(text, term) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = text.match(new RegExp(`\\b${escaped}`, "g"));
    return matches ? matches.length : 0;
  }

  window.BookSearch = {
    rebuildIndex,
    rankChunks,
    getMeaningfulTerms
  };
})();
