let fieldDataBridge = null;

if (typeof require === "function") {
  try {
    const { ipcRenderer } = require("electron");
    fieldDataBridge = ipcRenderer ?? null;
  } catch (error) {
    console.warn("IPC renderer unavailable:", error);
  }
}

const PRIORITY_LABELS = {
  routine: "Routine",
  important: "Important",
  urgent: "Urgent",
  draft: "Draft",
};

const PRIORITY_CLASSES = {
  routine: "status-pill--routine",
  important: "status-pill--important",
  urgent: "status-pill--urgent",
  draft: "status-pill--draft",
};

function sanitiseText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toPriorityKey(priority) {
  return sanitiseText(priority).toLowerCase();
}

function toPriorityLabel(priority) {
  const key = toPriorityKey(priority);
  return PRIORITY_LABELS[key] || PRIORITY_LABELS.important;
}

function toPriorityClass(priority) {
  const key = toPriorityKey(priority);
  return PRIORITY_CLASSES[key] || PRIORITY_CLASSES.important;
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch (error) {
    console.warn("Date formatting failed", error);
    return date.toLocaleString();
  }
}

function formatLocation(entry) {
  const latitude = sanitiseText(entry?.latitude || "");
  const longitude = sanitiseText(entry?.longitude || "");
  if (latitude && longitude) {
    return `${latitude}, ${longitude}`;
  }
  if (latitude) {
    return latitude;
  }
  if (longitude) {
    return longitude;
  }
  return "";
}

function formatCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "";
  }
  return parsed === 1 ? "1 individual" : `${parsed} individuals`;
}

function getInitials(name) {
  const parts = sanitiseText(name).split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return "--";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("field-data-form");
  if (!form) {
    return;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  const draftButton = form.querySelector('[data-action="draft"]');
  const clearButton = form.querySelector('[data-action="clear"]');
  const priorityChips = Array.from(
    form.querySelectorAll(".chip-group [data-priority]")
  );
  const tagContainer = document.querySelector(".tag-list");
  const notesField = document.getElementById("field-notes");
  const notesCounter = document.querySelector('[data-field="notes-count"]');
  const recentList = document.getElementById("recent-entries");
  const feedbackNode = document.getElementById("form-feedback");
  const autoTagButton = form.querySelector('[data-action="autotag-location"]');

  const latitudeInput = document.getElementById("field-latitude");
  const longitudeInput = document.getElementById("field-longitude");

  const userNameNode = document.getElementById("user-name");
  const userRoleNode = document.getElementById("user-role");
  const userAvatarNode = document.getElementById("user-avatar");

  const notesLimit = Number(notesField?.getAttribute("maxlength")) || 2000;

  function clearFeedback() {
    if (!feedbackNode) {
      return;
    }
    feedbackNode.textContent = "";
    feedbackNode.classList.remove("is-error", "is-success", "is-visible");
  }

  function setFeedback(message, type = "neutral") {
    if (!feedbackNode) {
      return;
    }
    feedbackNode.textContent = message || "";
    feedbackNode.classList.remove("is-error", "is-success", "is-visible");
    if (!message) {
      return;
    }
    if (type === "error") {
      feedbackNode.classList.add("is-error");
    } else if (type === "success") {
      feedbackNode.classList.add("is-success");
    }
    feedbackNode.classList.add("is-visible");
  }

  function getSelectedPriority() {
    const active = priorityChips.find((chip) =>
      chip.classList.contains("chip--active")
    );
    if (!active) {
      return PRIORITY_LABELS.important;
    }
    const key = active.dataset.priority;
    return PRIORITY_LABELS[key] || sanitiseText(active.textContent);
  }

  function setPriority(key) {
    priorityChips.forEach((chip) => {
      chip.classList.toggle(
        "chip--active",
        sanitiseText(chip.dataset.priority) === sanitiseText(key)
      );
    });
  }

  function getSelectedTags() {
    const activeTags = document.querySelectorAll(
      ".tag-list [data-tag].tag--active"
    );
    return Array.from(activeTags)
      .map((btn) => sanitiseText(btn.dataset.tag))
      .filter(Boolean);
  }

  function resetTags() {
    const tagButtons = document.querySelectorAll(".tag-list [data-tag]");
    tagButtons.forEach((btn) => btn.classList.remove("tag--active"));
  }

  function updateNotesCounter() {
    if (!notesCounter) {
      return;
    }
    const length = sanitiseText(notesField?.value || "").length;
    notesCounter.textContent = `Character count: ${length} / ${notesLimit}`;
  }

  function gatherFormData() {
    const formData = new FormData(form);
    const payload = {
      latitude: sanitiseText(formData.get("latitude")),
      longitude: sanitiseText(formData.get("longitude")),
      category: sanitiseText(formData.get("category")),
      species: sanitiseText(formData.get("species")),
      ageGroup: sanitiseText(formData.get("ageGroup")),
      behavior: sanitiseText(formData.get("behavior")),
      individualCount: sanitiseText(formData.get("individualCount")),
      weather: sanitiseText(formData.get("weather")),
      temperature: sanitiseText(formData.get("temperature")),
      visibility: sanitiseText(formData.get("visibility")),
      notes: sanitiseText(formData.get("notes")),
      priority: getSelectedPriority(),
      tags: getSelectedTags(),
    };

    if (!payload.species) {
      throw new Error("Species or subject is required.");
    }

    return payload;
  }

  function resetForm() {
    form.reset();
    resetTags();
    setPriority("important");
    updateNotesCounter();
  }

  function toggleButtonState(button, isLoading, loadingLabel) {
    if (!button) {
      return () => {};
    }
    const original = {
      text: button.textContent,
      disabled: button.disabled,
    };
    button.disabled = Boolean(isLoading);
    if (isLoading && loadingLabel) {
      button.textContent = loadingLabel;
    }

    return () => {
      button.disabled = original.disabled;
      button.textContent = original.text;
    };
  }

  async function persistEntry(
    payload,
    { button, loadingLabel, successMessage }
  ) {
    if (!fieldDataBridge || typeof fieldDataBridge.invoke !== "function") {
      throw new Error(
        "Data bridge unavailable. Launch the desktop app to save entries."
      );
    }

    const restoreButton = toggleButtonState(button, true, loadingLabel);

    try {
      const response = await fieldDataBridge.invoke(
        "fieldData:create",
        payload
      );
      if (!response?.ok) {
        throw new Error(response?.error || "Unable to save entry.");
      }
      setFeedback(successMessage || "Entry saved successfully.", "success");
      resetForm();
      await loadRecentEntries();
    } finally {
      restoreButton();
    }
  }

  async function submitEntry(overrides = {}, options = {}) {
    clearFeedback();

    let payload;
    try {
      payload = gatherFormData();
    } catch (error) {
      setFeedback(error.message, "error");
      return;
    }

    payload = { ...payload, ...overrides };

    try {
      await persistEntry(payload, options);
    } catch (error) {
      console.error("Failed to save entry:", error);
      setFeedback(error.message || "Unable to save entry.", "error");
    }
  }

  async function loadRecentEntries() {
    if (!recentList) {
      return;
    }

    if (!fieldDataBridge || typeof fieldDataBridge.invoke !== "function") {
      renderRecentEntries([]);
      return;
    }

    try {
      const response = await fieldDataBridge.invoke("fieldData:list", {
        limit: 5,
      });
      if (!response?.ok) {
        throw new Error(response?.error || "Invalid response");
      }
      renderRecentEntries(response.data || []);
    } catch (error) {
      console.error("Failed to load field data:", error);
      renderRecentEntries([]);
    }
  }

  function renderRecentEntries(entries) {
    if (!recentList) {
      return;
    }

    recentList.innerHTML = "";

    if (!entries || !entries.length) {
      const emptyMessage =
        recentList.dataset.emptyMessage ||
        "No field entries yet. Submit a report to see it listed here.";
      const emptyItem = document.createElement("li");
      emptyItem.className = "recent-list__empty";
      emptyItem.textContent = emptyMessage;
      recentList.appendChild(emptyItem);
      return;
    }

    entries.forEach((entry) => {
      const item = document.createElement("li");
      item.className = "recent-list__item";

      const info = document.createElement("div");
      const title = document.createElement("h3");
      const species = sanitiseText(entry?.species) || "Unknown record";
      const countLabel = formatCount(entry?.individualCount);
      title.textContent = countLabel ? `${species} • ${countLabel}` : species;

      const meta = document.createElement("p");
      const detailParts = [];

      const category = sanitiseText(entry?.category);
      if (category) {
        detailParts.push(category);
      }

      const when = formatDateTime(entry?.recordedAt);
      if (when) {
        detailParts.push(when);
      }

      const location = formatLocation(entry);
      if (location) {
        detailParts.push(location);
      }

      const priorityLabel = toPriorityLabel(entry?.priority);
      const priorityClass = toPriorityClass(entry?.priority);

      meta.textContent = detailParts.join(" • ") || "Recorded entry";

      info.appendChild(title);
      info.appendChild(meta);

      const status = document.createElement("span");
      status.className = `status-pill ${priorityClass}`;
      status.textContent = priorityLabel;

      item.appendChild(info);
      item.appendChild(status);

      recentList.appendChild(item);
    });
  }

  async function loadUserProfile() {
    if (!fieldDataBridge || typeof fieldDataBridge.invoke !== "function") {
      return;
    }

    try {
      const response = await fieldDataBridge.invoke("userProfile:get");
      if (!response?.ok) {
        throw new Error(response?.error || "Unable to fetch profile");
      }
      const profile = response.data;
      if (!profile) {
        return;
      }
      if (userNameNode && profile.name) {
        userNameNode.textContent = profile.name;
      }
      if (userRoleNode && profile.city) {
        userRoleNode.textContent = profile.city;
      }
      if (userAvatarNode && profile.name) {
        userAvatarNode.textContent = getInitials(profile.name);
      }
    } catch (error) {
      console.error("Failed to fetch user profile:", error);
    }
  }

  async function autoTagLocation() {
    if (!navigator.geolocation) {
      setFeedback("Geolocation not supported on this device.", "error");
      return;
    }

    if (!autoTagButton) {
      return;
    }

    const restore = toggleButtonState(autoTagButton, true, "Fetching...");

    const getPosition = () =>
      new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0,
        });
      });

    try {
      const position = await getPosition();
      const { latitude, longitude } = position.coords;
      if (latitudeInput) {
        latitudeInput.value = latitude.toFixed(6);
      }
      if (longitudeInput) {
        longitudeInput.value = longitude.toFixed(6);
      }
      setFeedback("Location auto-tagged from device sensors.", "success");
    } catch (error) {
      console.error("Geolocation lookup failed:", error);
      setFeedback("Unable to retrieve location. Please try again.", "error");
    } finally {
      restore();
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitEntry(
      {},
      {
        button: submitButton,
        loadingLabel: "Saving...",
        successMessage: "Field report submitted successfully.",
      }
    );
  });

  if (draftButton) {
    draftButton.addEventListener("click", () => {
      submitEntry(
        { priority: PRIORITY_LABELS.draft },
        {
          button: draftButton,
          loadingLabel: "Saving...",
          successMessage: "Draft stored locally.",
        }
      );
    });
  }

  if (clearButton) {
    clearButton.addEventListener("click", () => {
      resetForm();
      setFeedback("Form cleared.", "success");
      setTimeout(() => clearFeedback(), 1500);
    });
  }

  priorityChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      priorityChips.forEach((btn) => btn.classList.remove("chip--active"));
      chip.classList.add("chip--active");
    });
  });

  if (tagContainer) {
    tagContainer.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) {
        return;
      }

      const action = target.dataset.action;
      if (action === "add-custom-tag") {
        const input = window.prompt("Enter a custom tag label:");
        const label = sanitiseText(input || "");
        if (!label) {
          return;
        }

        const existing = Array.from(
          tagContainer.querySelectorAll("[data-tag]")
        ).some(
          (button) => button.dataset.tag?.toLowerCase() === label.toLowerCase()
        );

        if (existing) {
          setFeedback("Tag already exists.", "error");
          return;
        }

        const newButton = document.createElement("button");
        newButton.type = "button";
        newButton.className = "tag tag--active";
        newButton.dataset.tag = label;
        newButton.textContent = label;
        tagContainer.insertBefore(newButton, target);
        clearFeedback();
        return;
      }

      if (target.dataset.tag) {
        target.classList.toggle("tag--active");
        clearFeedback();
      }
    });
  }

  if (notesField) {
    notesField.addEventListener("input", updateNotesCounter);
    updateNotesCounter();
  }

  if (autoTagButton) {
    autoTagButton.addEventListener("click", autoTagLocation);
  }

  loadUserProfile();
  loadRecentEntries();
});
