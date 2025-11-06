const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { initDatabase, saveLoginSubmission, closeDatabase } = require("./db");

let mainWindow;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 900,
    minHeight: 600,
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

  await mainWindow.loadFile(path.join(__dirname, "../src/page/dashboard.html"));

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

ipcMain.handle("login:submit", async (_event, payload) => {
  try {
    const result = await saveLoginSubmission(payload);
    return { ok: true, data: result };
  } catch (error) {
    console.error("[database] failed to save login submission:", error);
    return { ok: false, error: error.message };
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  closeDatabase();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
