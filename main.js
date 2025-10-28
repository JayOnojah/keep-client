const {
  app,
  Tray,
  Menu,
  dialog,
  nativeImage,
  BrowserWindow,
} = require("electron");
const path = require("path");
const AutoLaunch = require("auto-launch");
const { exec } = require("child_process");

let tray = null;
let mainWindow = null;

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // Allow localhost HTTPS

// 🪟 Create hidden main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 560,
    show: false, // Start hidden
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile("renderer.html");

  // Prevent full quit when closing
  mainWindow.on("close", (event) => {
    event.preventDefault();
    mainWindow.hide();
  });
}

app.whenReady().then(() => {
  // 🖨️ Start print API server
  require("./server.js");

  // Create the main hidden window
  createWindow();

  // 🧩 Setup Tray icon
  const iconPath = path.join(__dirname, "assets", "iconTemplate.png");
  const trayIcon = nativeImage.createFromPath(iconPath);
  tray = new Tray(trayIcon);

  // Tray menu options
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Application",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: "Check Printer Status",
      click: () => {
        exec("lpstat -p", (err, stdout) => {
          const message = err
            ? "Printer check failed. Ensure a printer is connected."
            : stdout || "No printers found.";
          dialog.showMessageBox({ type: "info", message });
        });
      },
    },
    { type: "separator" },
    {
      label: "Restart Agent",
      click: () => {
        app.relaunch();
        app.quit();
      },
    },
    {
      label: "Quit KeepOS Agent",
      click: () => app.quit(),
    },
  ]);

  tray.setToolTip("KeepOS Print Agent");
  tray.setContextMenu(contextMenu);

  // Hide dock icon on macOS
  if (app.dock) app.dock.hide();

  // 🧠 Auto-launch at login
  const keepOSAutoLauncher = new AutoLaunch({
    name: "KeepOS Print Agent",
  });

  keepOSAutoLauncher.isEnabled().then((enabled) => {
    if (!enabled) keepOSAutoLauncher.enable();
  });

  console.log("✅ KeepOS Print Agent running silently in tray.");
});

// Prevent exit when all windows are closed
app.on("window-all-closed", (e) => e.preventDefault());
