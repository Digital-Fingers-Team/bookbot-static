(function () {
  "use strict";

  const NOT_FOUND = "Information not found in the uploaded books.";

  async function answerQuestion(question, context) {
    const usableContext = Array.isArray(context) ? context.filter((item) => item && item.chunkText) : [];

    if (usableContext.length === 0) {
      return {
        answer: NOT_FOUND,
        sources: []
      };
    }

    const messages = buildOpenRouterMessages(question, usableContext);

    // OPENROUTER API INTEGRATION POINT
    const OPENROUTER_API_KEY = localStorage.getItem("BOOKBOT_OPENROUTER_API_KEY") || "";
    const OPENROUTER_MODEL = "openai/gpt-4o-mini";
    const OPENROUTER_SITE_URL = "";
    const OPENROUTER_SITE_NAME = "BookBot";

    if (OPENROUTER_API_KEY.trim()) {
      const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY.trim()}`
      };

      if (OPENROUTER_SITE_URL.trim()) {
        headers["HTTP-Referer"] = OPENROUTER_SITE_URL.trim();
      }

      if (OPENROUTER_SITE_NAME.trim()) {
        headers["X-OpenRouter-Title"] = OPENROUTER_SITE_NAME.trim();
      }

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          messages,
          temperature: 0,
          top_p: 0.2,
          max_tokens: 512
        })
      });

      if (!response.ok) {
        throw new Error("OpenRouter request failed. Check the API key, model name, and browser console.");
      }

      const data = await response.json();
      const text = getOpenRouterText(data);

      const answer = sanitizeAnswer(text);

      return {
        answer,
        sources: isNotFound(answer) ? [] : buildSources(question, usableContext)
      };
    }

    const answer = createExtractiveAnswer(question, usableContext);

    return {
      answer,
      sources: isNotFound(answer) ? [] : buildSources(question, usableContext)
    };
  }

  function buildOpenRouterMessages(question, context) {
    const contextText = context
      .map((item, index) => {
        return [
          `[Source ${index + 1}]`,
          `Book: ${item.bookName}`,
          `Page: ${item.pageNumber}`,
          `Text: ${item.chunkText}`
        ].join("\n");
      })
      .join("\n\n");

    const systemPrompt = [
      "You are a retrieval-based knowledge assistant for uploaded books.",
      "Answer ONLY using the provided context.",
      "Do NOT use outside knowledge.",
      "Do NOT make assumptions.",
      "Do NOT invent facts.",
      `If the answer is not found in the context, reply exactly: "${NOT_FOUND}"`,
      "Return concise factual answers.",
      "Do not include greetings.",
      "Do not include conversational filler.",
      "Do not include opinions."
    ].join("\n");

    const userPrompt = [
      "Context:",
      contextText,
      "",
      `Question: ${question}`
    ].join("\n");

    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ];
  }

  function getOpenRouterText(data) {
    const message = data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message;

    if (!message) {
      return "";
    }

    if (typeof message.content === "string") {
      return message.content;
    }

    if (Array.isArray(message.content)) {
      return message.content
        .map((part) => {
          if (typeof part === "string") {
            return part;
          }
          return part && typeof part.text === "string" ? part.text : "";
        })
        .join("");
    }

    return "";
  }

  function createExtractiveAnswer(question, context) {
    const terms = getTerms(question);
    const candidateSentences = [];

    context.forEach((item) => {
      splitSentences(item.chunkText).forEach((sentence) => {
        const score = scoreSentence(sentence, terms);
        if (score > 0) {
          candidateSentences.push({ sentence, score });
        }
      });
    });

    if (candidateSentences.length === 0) {
      return NOT_FOUND;
    }

    return candidateSentences
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((item) => item.sentence)
      .join(" ");
  }

  function buildSources(question, context) {
    return context.slice(0, 4).map((item) => ({
      bookName: item.bookName,
      pageNumber: item.pageNumber,
      excerpt: createExcerpt(question, item.chunkText),
      chunkText: item.chunkText
    }));
  }

  function createExcerpt(question, text) {
    const terms = getTerms(question);
    const sentence = splitSentences(text)
      .map((candidate) => ({ candidate, score: scoreSentence(candidate, terms) }))
      .sort((a, b) => b.score - a.score)[0];
    const excerpt = sentence && sentence.score > 0 ? sentence.candidate : text;

    if (excerpt.length <= 260) {
      return excerpt;
    }

    return `${excerpt.slice(0, 257).trim()}...`;
  }

  function sanitizeAnswer(value) {
    const answer = String(value || "").trim();
    return answer || NOT_FOUND;
  }

  function isNotFound(answer) {
    return String(answer || "").trim() === NOT_FOUND;
  }

  function splitSentences(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  }

  function scoreSentence(sentence, terms) {
    const lowerSentence = String(sentence || "").toLowerCase();
    return terms.reduce((total, term) => {
      return total + (lowerSentence.includes(term) ? 1 : 0);
    }, 0);
  }

  function getTerms(question) {
    if (window.BookSearch && typeof window.BookSearch.getMeaningfulTerms === "function") {
      return window.BookSearch.getMeaningfulTerms(question);
    }

    return String(question || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((term) => term.length > 2);
  }

  window.answerQuestion = answerQuestion;
  window.BookAnswer = {
    answerQuestion,
    buildOpenRouterMessages
  };
})();
