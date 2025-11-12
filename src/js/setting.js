const STORAGE_KEY = "ecowatch-user-settings";

const defaultUser = {
  fullName: "Varun Singh Rana",
  email: "varun.rana@example.com",
  role: "Developer",
  location: "Dehradun, India",
};

document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("#user-form");
  if (!form) {
    return;
  }

  const statusEl = form.querySelector(".form-status");

  const populateForm = (data) => {
    const values = { ...defaultUser, ...data };
    Object.entries(values).forEach(([name, value]) => {
      const input = form.elements.namedItem(name);
      if (!input) {
        return;
      }
      input.value = value || "";
    });
  };

  const loadUser = () => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.warn("Could not read saved settings", error);
    }
    return null;
  };

  const persistUser = (data) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (error) {
      console.warn("Could not save settings", error);
      return false;
    }
  };

  const showStatus = (message) => {
    if (statusEl) {
      statusEl.textContent = message;
    }
  };

  const savedUser = loadUser();
  populateForm(savedUser);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    const ok = persistUser(data);
    if (ok) {
      showStatus(`Saved at ${new Date().toLocaleTimeString()}`);
    } else {
      showStatus("Could not save changes. Please try again.");
    }
  });
});
