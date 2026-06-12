(function () {
  "use strict";

  const SESSION_KEY = "bookbotSession";
  const HARDCODED_ADMIN = {
    userId: "hardcoded-admin",
    name: "Admin",
    email: "admin@example.com",
    role: "admin"
  };

  async function signUpUser(details) {
    await window.BookBotDB.initDB();

    const name = String(details.name || "").trim();
    const email = normalizeEmail(details.email);
    const password = String(details.password || "");
    const role = "reader";

    if (!name) {
      throw new Error("Enter your name.");
    }

    if (!isValidEmail(email)) {
      throw new Error("Enter a valid email address.");
    }

    if (password.length < 6) {
      throw new Error("Password must be at least 6 characters.");
    }

    if (email === HARDCODED_ADMIN.email) {
      throw new Error("This email is reserved for the admin account.");
    }

    const existing = await window.BookBotDB.getUserByEmail(email);
    if (existing) {
      throw new Error("An account with this email already exists.");
    }

    const salt = createSalt();
    const passwordHash = await hashPassword(password, salt);
    const user = {
      userId: createId(),
      name,
      email,
      role,
      salt,
      passwordHash,
      createdAt: new Date().toISOString()
    };

    await window.BookBotDB.saveUser(user);
    setSession(user);

    return publicUser(user);
  }

  async function logInUser(email, password) {
    await window.BookBotDB.initDB();

    const normalizedEmail = normalizeEmail(email);

    if (normalizedEmail === HARDCODED_ADMIN.email && String(password || "") === "admin123") {
      setSession(HARDCODED_ADMIN);
      return publicUser(HARDCODED_ADMIN);
    }

    const user = await window.BookBotDB.getUserByEmail(normalizedEmail);

    if (!user) {
      throw new Error("Invalid email or password.");
    }

    const passwordHash = await hashPassword(String(password || ""), user.salt);

    if (passwordHash !== user.passwordHash) {
      throw new Error("Invalid email or password.");
    }

    setSession(user);
    return publicUser(user);
  }

  function logOutUser() {
    localStorage.removeItem(SESSION_KEY);
    window.location.href = "login.html";
  }

  async function requireAuth(allowedRoles) {
    await window.BookBotDB.initDB();

    const session = getSession();
    if (!session) {
      window.location.href = "login.html";
      return null;
    }

    if (session.userId === HARDCODED_ADMIN.userId) {
      return authorizeUser(HARDCODED_ADMIN, allowedRoles);
    }

    const user = await window.BookBotDB.getUser(session.userId);
    if (!user) {
      localStorage.removeItem(SESSION_KEY);
      window.location.href = "login.html";
      return null;
    }

    return authorizeUser(user, allowedRoles);
  }

  async function redirectIfAuthenticated() {
    await window.BookBotDB.initDB();

    const session = getSession();
    if (!session) {
      return null;
    }

    if (session.userId === HARDCODED_ADMIN.userId) {
      window.location.href = "admin.html";
      return publicUser(HARDCODED_ADMIN);
    }

    const user = await window.BookBotDB.getUser(session.userId);
    if (!user) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }

    window.location.href = user.role === "admin" ? "admin.html" : "library.html";
    return publicUser(user);
  }

  function getSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY));
    } catch (error) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
  }

  function setSession(user) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(publicUser(user)));
  }

  function authorizeUser(user, allowedRoles) {
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    if (roles.length > 0 && !roles.includes(user.role)) {
      window.location.href = user.role === "admin" ? "admin.html" : "library.html";
      return null;
    }

    setSession(user);
    return publicUser(user);
  }

  function publicUser(user) {
    return {
      userId: user.userId,
      name: user.name,
      email: user.email,
      role: user.role
    };
  }

  async function hashPassword(password, salt) {
    const value = `${salt}:${password}`;

    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      const bytes = new TextEncoder().encode(value);
      const digest = await window.crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    }

    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fallback-${(hash >>> 0).toString(16)}`;
  }

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function createSalt() {
    if (window.crypto && window.crypto.getRandomValues) {
      const values = new Uint32Array(4);
      window.crypto.getRandomValues(values);
      return Array.from(values).map((value) => value.toString(16)).join("");
    }

    return `${Date.now()}${Math.random().toString(16).slice(2)}`;
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    return `user-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  window.BookAuth = {
    signUpUser,
    logInUser,
    logOutUser,
    requireAuth,
    redirectIfAuthenticated,
    getSession
  };
})();
