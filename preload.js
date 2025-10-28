const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agent", {
  async getStatus() {
    return ipcRenderer.invoke("agent-get-status");
  },
  openLogs() {
    ipcRenderer.send("agent-open-logs");
  },
});
