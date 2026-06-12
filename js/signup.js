(function () {
  "use strict";

  const form = document.getElementById("signupForm");
  const nameInput = document.getElementById("nameInput");
  const emailInput = document.getElementById("emailInput");
  const passwordInput = document.getElementById("passwordInput");
  const authStatus = document.getElementById("authStatus");

  document.addEventListener("DOMContentLoaded", async () => {
    await window.BookAuth.redirectIfAuthenticated();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("Creating account...");

    try {
      const user = await window.BookAuth.signUpUser({
        name: nameInput.value,
        email: emailInput.value,
        password: passwordInput.value
      });
      window.location.href = "library.html";
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
