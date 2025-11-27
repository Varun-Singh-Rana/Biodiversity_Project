let windowControlBridge = null;

if (typeof require === "function") {
  try {
    const electron = require("electron");
    windowControlBridge = electron?.ipcRenderer ?? null;
  } catch (error) {
    console.warn("IPC renderer unavailable for window controls:", error);
  }
}

function updateMaximizeButton(button, isMaximized) {
  if (!button) {
    return;
  }

  button.dataset.windowState = isMaximized ? "maximized" : "restored";
  const icon = button.querySelector(".window-control-icon");
  if (icon) {
    icon.textContent = isMaximized ? "[ ]" : "[]";
  }
  button.setAttribute("aria-label", isMaximized ? "Restore" : "Maximize");
}

async function handleWindowAction(action, button) {
  if (!windowControlBridge) {
    console.warn("window control requested without IPC bridge:", action);
    return;
  }

  try {
    const response = await windowControlBridge.invoke("window-control", action);
    if (action === "toggle-maximize" && response) {
      updateMaximizeButton(button, Boolean(response.isMaximized));
    }
  } catch (error) {
    console.error("Window control failed:", error);
  }
}

function initWindowControls() {
  const buttons = document.querySelectorAll("[data-window-action]");
  if (!buttons.length) {
    return;
  }

  buttons.forEach((button) => {
    const action = button.dataset.windowAction;
    button.addEventListener("click", () => handleWindowAction(action, button));
  });

  const maximizeButton = document.querySelector(
    '[data-window-action="toggle-maximize"]'
  );

  if (maximizeButton && windowControlBridge) {
    windowControlBridge
      .invoke("window-control", "query-maximized")
      .then((state) => {
        if (state) {
          updateMaximizeButton(maximizeButton, Boolean(state.isMaximized));
        }
      });
  }
}

document.addEventListener("DOMContentLoaded", initWindowControls);
