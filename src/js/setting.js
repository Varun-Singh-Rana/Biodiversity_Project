let settingsBridge = null;

if (typeof require === "function") {
  try {
    const { ipcRenderer } = require("electron");
    settingsBridge = ipcRenderer ?? null;
  } catch (error) {
    console.warn("IPC renderer unavailable for settings:", error);
  }
}

function sanitiseText(value) {
  return typeof value === "string" ? value.trim() : "";
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("#user-form");
  if (!form) {
    return;
  }

  const feedbackEl = document.getElementById("form-feedback");
  const submitButton = form.querySelector('button[type="submit"]');

  const nameInput = form.elements.namedItem("name");
  const emailInput = form.elements.namedItem("email");
  const dobInput = form.elements.namedItem("dob");
  const cityInput = form.elements.namedItem("city");

  const userNameNode = document.getElementById("user-name");
  const userRoleNode = document.getElementById("user-role");
  const userAvatarNode = document.getElementById("user-avatar");

  function setFeedback(message, type = "neutral") {
    if (!feedbackEl) {
      return;
    }
    feedbackEl.textContent = message || "";
    feedbackEl.classList.remove("form-status--success", "form-status--error");
    if (!message) {
      return;
    }
    if (type === "success") {
      feedbackEl.classList.add("form-status--success");
    } else if (type === "error") {
      feedbackEl.classList.add("form-status--error");
    }
  }

  function updateHeader(profile) {
    if (profile?.name && userNameNode) {
      userNameNode.textContent = profile.name;
    }
    if (profile?.city && userRoleNode) {
      userRoleNode.textContent = profile.city;
    }
    if (profile?.name && userAvatarNode) {
      const parts = sanitiseText(profile.name).split(/\s+/).filter(Boolean);
      if (!parts.length) {
        userAvatarNode.textContent = "EW";
      } else if (parts.length === 1) {
        userAvatarNode.textContent = parts[0].slice(0, 2).toUpperCase();
      } else {
        userAvatarNode.textContent = `${parts[0][0]}${
          parts[parts.length - 1][0]
        }`.toUpperCase();
      }
    }
  }

  function populateForm(profile) {
    if (!profile) {
      return;
    }
    if (nameInput) {
      nameInput.value = profile.name || "";
    }
    if (emailInput) {
      emailInput.value = profile.email || "";
    }
    if (dobInput) {
      dobInput.value = profile.dob || "";
    }
    if (cityInput) {
      cityInput.value = profile.city || "";
    }
    updateHeader(profile);
  }

  function collectPayload() {
    const payload = {
      name: sanitiseText(nameInput?.value),
      email: sanitiseText(emailInput?.value),
      dob: sanitiseText(dobInput?.value),
      city: sanitiseText(cityInput?.value),
    };

    if (!payload.name || payload.name.length < 3) {
      throw new Error("Name should be at least 3 characters long.");
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailPattern.test(payload.email)) {
      throw new Error("Enter a valid email address.");
    }

    if (!payload.dob) {
      throw new Error("Date of birth is required.");
    }
    const dobDate = new Date(payload.dob);
    if (Number.isNaN(dobDate.getTime())) {
      throw new Error("Enter a valid date of birth.");
    }

    if (!payload.city) {
      throw new Error("City is required.");
    }

    return payload;
  }

  async function loadProfile() {
    if (!settingsBridge || typeof settingsBridge.invoke !== "function") {
      return;
    }

    try {
      const response = await settingsBridge.invoke("userProfile:get");
      if (!response?.ok) {
        throw new Error(response?.error || "Unable to fetch profile.");
      }
      populateForm(response.data || {});
    } catch (error) {
      console.error("Failed to load profile:", error);
      setFeedback("Could not load profile. Try again later.", "error");
    }
  }

  async function saveProfile(payload) {
    if (!settingsBridge || typeof settingsBridge.invoke !== "function") {
      throw new Error("Profile bridge unavailable. Launch the desktop app.");
    }
    const response = await settingsBridge.invoke("userProfile:save", payload);
    if (!response?.ok) {
      throw new Error(response?.error || "Unable to save profile.");
    }
    return response.data;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFeedback("");

    const originalLabel = submitButton?.textContent;

    try {
      const payload = collectPayload();

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Saving...";
      }

      const savedProfile = await saveProfile(payload);
      populateForm(savedProfile);
      setFeedback("Profile updated successfully.", "success");
    } catch (error) {
      console.error("Profile save failed:", error);
      setFeedback(error.message || "Unable to save profile.", "error");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        if (originalLabel) {
          submitButton.textContent = originalLabel;
        }
      }
    }
  });

  loadProfile();
});
