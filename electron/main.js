const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const {
  initDatabase,
  saveUserProfile,
  hasUserProfile,
  closeDatabase,
} = require("./db");

let mainWindow;

async function createWindow() {
  const isFirstRun = !(await hasUserProfile());
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1200,
    minHeight: 800,
    icon: path.join(__dirname, "../src/assets/logo.ico"),
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      enableRemoteModule: true,
      sandbox: false,
      devTools: process.env.NODE_ENV === "development",
      autoplayPolicy: "document-user-activation-required",
    },
    frame: false,
    show: false,
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  const entryFile = isFirstRun ? "login.html" : "dashboard.html";
  await mainWindow.loadFile(path.join(__dirname, "../src/page", entryFile));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    await initDatabase();
  } catch (error) {
    console.error("[database] initialization failed:", error);
  }

  await createWindow();
});

ipcMain.handle("userProfile:save", async (_event, payload) => {
  try {
    const profile = await saveUserProfile(payload);
    return { ok: true, data: profile };
  } catch (error) {
    console.error("[database] failed to save user profile:", error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("window-control", (event, action) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender);
  if (!targetWindow) {
    return null;
  }

  switch (action) {
    case "minimize":
      targetWindow.minimize();
      return null;
    case "toggle-maximize":
      if (targetWindow.isMaximized()) {
        targetWindow.unmaximize();
      } else {
        targetWindow.maximize();
      }
      return { isMaximized: targetWindow.isMaximized() };
    case "close":
      targetWindow.close();
      return null;
    case "query-maximized":
      return { isMaximized: targetWindow.isMaximized() };
    default:
      console.warn("[window] unknown control action:", action);
      return null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  closeDatabase().catch((error) => {
    console.error("[database] failed to close cleanly:", error);
  });
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
