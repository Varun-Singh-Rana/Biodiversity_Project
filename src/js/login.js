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
  const form = document.getElementById("onboarding-form");
  if (!form) {
    return;
  }

  const submitButton = form.querySelector("button[type='submit']");
  const feedback = document.getElementById("form-feedback");

  function setFeedback(message, isError = false) {
    if (!feedback) {
      return;
    }

    feedback.textContent = message;
    feedback.classList.toggle("error", Boolean(isError));
  }

  function gatherPayload() {
    const formData = new FormData(form);

    return {
      name: (formData.get("fullName") || "").trim(),
      email: (formData.get("email") || "").trim(),
      dob: (formData.get("dob") || "").trim(),
      city: (formData.get("city") || "").trim(),
    };
  }

  function validate(payload) {
    const missing = [];

    if (!payload.name) {
      missing.push("full name");
    }

    if (!payload.email) {
      missing.push("email address");
    }

    if (!payload.dob) {
      missing.push("date of birth");
    }

    if (!payload.city) {
      missing.push("city");
    }

    if (missing.length) {
      throw new Error(`Please provide your ${missing.join(", ")}.`);
    }

    if (payload.name.length < 3) {
      throw new Error("Name should be at least 3 characters long.");
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailPattern.test(payload.email)) {
      throw new Error("Enter a valid email address.");
    }

    const dobDate = new Date(payload.dob);
    if (Number.isNaN(dobDate.getTime())) {
      throw new Error("Enter a valid date of birth.");
    }

    const today = new Date();
    if (dobDate > today) {
      throw new Error("Date of birth cannot be in the future.");
    }

    return payload;
  }

  async function saveProfile(payload) {
    if (!ipcRenderer || typeof ipcRenderer.invoke !== "function") {
      throw new Error(
        "Profile bridge is unavailable. Launch the app through Electron after installing dependencies."
      );
    }

    const response = await ipcRenderer.invoke("userProfile:save", payload);
    if (!response?.ok) {
      throw new Error(response?.error || "Unable to save profile.");
    }

    return response.data;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFeedback("");

    const originalLabel = submitButton?.textContent;

    try {
      const payload = validate(gatherPayload());

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.dataset.loading = "true";
        submitButton.textContent = "Saving...";
      }

      await saveProfile(payload);

      setFeedback("Profile saved. Redirecting to your dashboard...");

      setTimeout(() => {
        window.location.href = "./dashboard.html";
      }, 900);
    } catch (error) {
      console.error("Profile setup failed:", error);
      setFeedback(error.message || "Unable to save profile.", true);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.dataset.loading = "false";
        if (originalLabel) {
          submitButton.textContent = originalLabel;
        }
      }
    }
  }

  form.addEventListener("submit", handleSubmit);
});
