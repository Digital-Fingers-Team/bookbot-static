(function () {
  "use strict";

  const form = document.getElementById("loginForm");
  const emailInput = document.getElementById("emailInput");
  const passwordInput = document.getElementById("passwordInput");
  const authStatus = document.getElementById("authStatus");

  document.addEventListener("DOMContentLoaded", async () => {
    await window.BookAuth.redirectIfAuthenticated();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("Logging in...");

    try {
      const user = await window.BookAuth.logInUser(emailInput.value, passwordInput.value);
      window.location.href = user.role === "admin" ? "admin.html" : "library.html";
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  function setStatus(message, tone) {
    authStatus.className = "status-line";
    if (tone) {
      authStatus.classList.add(tone);
    }
    authStatus.textContent = message || "";
  }
})();
