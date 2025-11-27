const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const { app, BrowserWindow, ipcMain } = require("electron");
const {
  initDatabase,
  saveUserProfile,
  hasUserProfile,
  closeDatabase,
  getUserProfile,
  saveFieldData,
  listFieldData,
} = require("./db");
const {
  startDailyDigestScheduler,
  stopDailyDigestScheduler,
} = require("../src/notification/scheduler");
const { collectEnvironmentalSummary } = require("../src/notification/api");

function loadEnvironmentConfiguration() {
  const candidates = new Set([
    path.join(__dirname, "..", ".env"),
    path.join(process.cwd(), ".env"),
  ]);

  if (process.resourcesPath) {
    candidates.add(path.join(process.resourcesPath, ".env"));
  }

  try {
    const appPath = app?.getAppPath?.();
    if (appPath) {
      candidates.add(path.join(appPath, ".env"));
    }
  } catch (error) {
    console.warn("[env] Failed to resolve app path:", error);
  }

  try {
    const userData = app?.getPath?.("userData");
    if (userData) {
      candidates.add(path.join(userData, ".env"));
    }
  } catch (error) {
    console.warn("[env] Failed to resolve userData path:", error);
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      console.info(`[env] Loaded configuration from ${candidate}`);
      return candidate;
    }
  }

  dotenv.config();
  console.warn(
    "[env] No .env file found. Using process-level environment only."
  );
  return null;
}

function mirrorEnvToUserData(sourcePath) {
  if (!sourcePath || !app?.isPackaged) {
    return;
  }

  try {
    const userDataDir = app.getPath("userData");
    const targetPath = path.join(userDataDir, ".env");
    if (path.resolve(sourcePath) === path.resolve(targetPath)) {
      return;
    }
    if (!fs.existsSync(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
      console.info(`[env] Copied configuration to ${targetPath}`);
    }
  } catch (error) {
    console.warn("[env] Failed to mirror environment configuration:", error);
  }
}

const envFilePath = loadEnvironmentConfiguration();

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

  mirrorEnvToUserData(envFilePath);

  startDailyDigestScheduler();

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

ipcMain.handle("userProfile:get", async () => {
  try {
    const profile = await getUserProfile();
    return { ok: true, data: profile };
  } catch (error) {
    console.error("[database] failed to load user profile:", error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("fieldData:create", async (_event, payload) => {
  try {
    const saved = await saveFieldData(payload);
    return { ok: true, data: saved };
  } catch (error) {
    console.error("[database] failed to save field data:", error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("fieldData:list", async (_event, options = {}) => {
  try {
    const limit =
      typeof options?.limit === "number" ? options.limit : undefined;
    const rows = await listFieldData(limit);
    return { ok: true, data: rows };
  } catch (error) {
    console.error("[database] failed to list field data:", error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("environment:summary", async (_event, options = {}) => {
  try {
    let targetCity = (options?.city || "").trim();
    if (!targetCity) {
      const profile = await getUserProfile();
      if (profile?.city) {
        targetCity = profile.city;
      }
    }

    const summary = await collectEnvironmentalSummary(targetCity);
    return { ok: true, data: summary };
  } catch (error) {
    console.error("[environment] failed to collect summary:", error);
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
  stopDailyDigestScheduler();
  closeDatabase().catch((error) => {
    console.error("[database] failed to close cleanly:", error);
  });
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
