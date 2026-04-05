const { contextBridge, ipcRenderer } = require("electron");

/** At most one end-session listener — React re-mounts were stacking ipcRenderer.on callbacks. */
let endSessionListener = null;

contextBridge.exposeInMainWorld("electronAPI", {
  sessionStarted: () => ipcRenderer.send("session-started"),
  sessionEnded: () => ipcRenderer.send("session-ended"),
  speakingState: (val) => ipcRenderer.send("speaking-state", val),
  onEndSession: (cb) => {
    if (endSessionListener) {
      ipcRenderer.removeListener("end-session", endSessionListener);
      endSessionListener = null;
    }
    endSessionListener = (_event) => {
      try {
        cb();
      } catch (e) {
        console.error("[electronAPI] end-session handler", e);
      }
    };
    ipcRenderer.on("end-session", endSessionListener);
  },
  /** Call on React unmount — removes the single listener (no callback ref needed). */
  offEndSession: () => {
    if (endSessionListener) {
      ipcRenderer.removeListener("end-session", endSessionListener);
      endSessionListener = null;
    }
  },
  onSpeakingState: (cb) => ipcRenderer.on("speaking-state", (_, val) => cb(val)),
  endSession: () => ipcRenderer.send("end-session"),
  openExternalUrl: (url) => ipcRenderer.invoke("open-external-url", url),
});
