let ipcRenderer = null;

if (typeof require === "function") {
  try {
    const electron = require("electron");
    ipcRenderer = electron?.ipcRenderer ?? null;
  } catch (error) {
    console.warn("IPC renderer not available:", error);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("access-form");
  if (!form) {
    return;
  }

  const hiddenModeField = form.querySelector("input[name='mode']");
  const toggleButtons = Array.from(
    document.querySelectorAll("[data-mode-toggle]")
  );
  const guestSections = Array.from(
    document.querySelectorAll("[data-section='guest']")
  );
  const departmentSections = Array.from(
    document.querySelectorAll("[data-section='department']")
  );
  const submitButton = form.querySelector("button[type='submit']");
  const feedback = document.getElementById("form-feedback");

  let currentMode = "guest";

  function setFeedback(message, isError = false) {
    if (!feedback) {
      return;
    }

    feedback.textContent = message;
    feedback.classList.toggle("error", Boolean(isError));
  }

  function setMode(mode) {
    currentMode = mode;
    hiddenModeField.value = mode;

    toggleButtons.forEach((button) => {
      const isActive = button.dataset.modeToggle === mode;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    });

    guestSections.forEach((section) => {
      section.classList.toggle("hidden", mode !== "guest");
      section
        .querySelectorAll("input")
        .forEach((input) =>
          input.toggleAttribute("required", mode === "guest")
        );
    });

    departmentSections.forEach((section) => {
      section.classList.toggle("hidden", mode !== "department");
      section
        .querySelectorAll("input")
        .forEach((input) =>
          input.toggleAttribute("required", mode === "department")
        );
    });

    if (submitButton) {
      submitButton.textContent =
        mode === "guest" ? "Request Guest Access" : "Login to Dashboard";
    }

    setFeedback("");
  }

  toggleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.modeToggle;
      if (mode && mode !== currentMode) {
        setMode(mode);
      }
    });
  });

  function gatherPayload() {
    const formData = new FormData(form);

    return {
      mode: currentMode,
      departmentId: (formData.get("departmentId") || "").trim(),
      email: (formData.get("email") || "").trim(),
      institution: (formData.get("institution") || "").trim(),
      accessCode: (formData.get("accessCode") || "").trim(),
      password: formData.get("password") || "",
      otp: (formData.get("otp") || "").trim(),
    };
  }

  function validate(payload) {
    const missing = [];

    if (!payload.departmentId) {
      missing.push("Department ID");
    }

    if (payload.mode === "guest") {
      if (!payload.email) {
        missing.push("Email address");
      }
      if (!payload.institution) {
        missing.push("Institution/Organization");
      }
      if (!payload.accessCode) {
        missing.push("Guest access code");
      }
    } else {
      if (!payload.password) {
        missing.push("Password");
      }
    }

    if (missing.length) {
      throw new Error(`Please provide: ${missing.join(", ")}.`);
    }

    if (
      payload.mode === "department" &&
      payload.otp &&
      !/^\d{6}$/.test(payload.otp)
    ) {
      throw new Error("OTP must be a 6-digit code.");
    }

    return payload;
  }

  async function submitToDatabase(payload) {
    if (!ipcRenderer || typeof ipcRenderer.invoke !== "function") {
      throw new Error(
        "Database bridge is unavailable. Ensure the application runs inside Electron and dependencies are installed."
      );
    }

    const response = await ipcRenderer.invoke("login:submit", payload);
    if (!response?.ok) {
      throw new Error(response?.error || "Unable to save record.");
    }

    return response.data;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFeedback("");

    const spinnerText = submitButton?.textContent;

    try {
      const payload = validate(gatherPayload());

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.dataset.loading = "true";
      }

      const { id } = await submitToDatabase(payload);

      setFeedback(
        payload.mode === "guest"
          ? "Guest access request submitted successfully."
          : "Credentials verified. Redirecting to dashboard..."
      );

      form.reset();
      hiddenModeField.value = payload.mode;

      if (payload.mode === "department") {
        setTimeout(() => {
          window.location.href = "./dashboard.html";
        }, 1200);
      }
    } catch (error) {
      console.error("Login submission failed:", error);
      setFeedback(error.message || "Unable to process request.", true);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.dataset.loading = "false";
        if (spinnerText) {
          submitButton.textContent = spinnerText;
        }
      }
    }
  }

  form.addEventListener("submit", handleSubmit);

  setMode(currentMode);
});
