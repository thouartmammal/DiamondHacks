import { app, BrowserWindow, shell, ipcMain, screen } from 'electron'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { spawn } from 'child_process'
import { config } from 'dotenv'
import http from 'http'
import fs from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isDev = process.env.NODE_ENV === 'development'

config({ path: join(__dirname, '..', '.env') })

/**
 * Match backend `boomerUserDataRoot()` (voice.js): `%APPDATA%\Boomer Browse` when BOOMER_USER_DATA is unset.
 * Default Electron userData uses package.json "name" (e.g. @figma scope) — that split caused the app to
 * save loved-ones.json in one folder while `npm run voice` / the browser extension read another.
 */
const legacyUserData = app.getPath('userData')
const unifiedUserData = join(app.getPath('appData'), 'Boomer Browse')
app.setPath('userData', unifiedUserData)
try {
  const destJson = join(unifiedUserData, 'loved-ones.json')
  const srcJson = join(legacyUserData, 'loved-ones.json')
  if (!fs.existsSync(srcJson)) {
    /* nothing to migrate */
  } else {
    let needCopy = !fs.existsSync(destJson)
    if (!needCopy && fs.existsSync(destJson)) {
      try {
        const d = JSON.parse(fs.readFileSync(destJson, 'utf8'))
        const s = JSON.parse(fs.readFileSync(srcJson, 'utf8'))
        const dArr = Array.isArray(d.people) ? d.people : []
        const sArr = Array.isArray(s.people) ? s.people : []
        const pictureCount = (arr) =>
          arr.filter(
            (p) =>
              p &&
              typeof p.picture === 'string' &&
              p.picture.startsWith('data:image'),
          ).length
        if (pictureCount(sArr) > pictureCount(dArr)) needCopy = true
        if (sArr.length > dArr.length) needCopy = true
      } catch {
        /* keep existing dest */
      }
    }
    if (needCopy) {
      fs.mkdirSync(unifiedUserData, { recursive: true })
      if (fs.existsSync(destJson)) {
        fs.copyFileSync(destJson, `${destJson}.bak-${Date.now()}`)
      }
      fs.copyFileSync(srcJson, destJson)
      const touched = 'loved-ones.touched'
      const srcT = join(legacyUserData, touched)
      const destT = join(unifiedUserData, touched)
      if (fs.existsSync(srcT)) fs.copyFileSync(srcT, destT)
      console.log('[Boomer] Migrated loved-ones from', legacyUserData, '→', unifiedUserData)
    }
  }
} catch (e) {
  console.warn('[Boomer] loved-ones migration:', e)
}

let backendProcess = null
let mainWin = null
let waveWin = null
let sessionActive = false

/** Avoid loading the UI before the voice server can answer (empty tree / failed fetch). */
function waitForBackend(port = 3001, maxMs = 25000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(`http://127.0.0.1:${port}/loved-ones`, (res) => {
        res.resume()
        resolve()
      })
      req.on('error', () => {
        if (Date.now() - start > maxMs) {
          reject(new Error(`Backend not reachable on port ${port} within ${maxMs}ms (is Node.js installed and on PATH?)`))
          return
        }
        setTimeout(attempt, 250)
      })
      req.setTimeout(2000, () => {
        req.destroy()
      })
    }
    attempt()
  })
}

function startBackend() {
  const backendPath = isDev
    ? join(__dirname, '..', 'backend')
    : join(process.resourcesPath, 'backend')

  backendProcess = spawn('node', ['src/voice.js'], {
    cwd: backendPath,
    env: {
      ...process.env,
      BOOMER_USER_DATA: app.getPath('userData'),
    },
    stdio: 'inherit',
  })

  backendProcess.on('error', (err) => console.error('Backend failed to start:', err))
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.js'),
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f0f7ff',
  })

  // Grant microphone permission automatically
  mainWin.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'microphone' || permission === 'audioCapture') {
      callback(true)
    } else {
      callback(false)
    }
  })

  mainWin.webContents.session.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media' || permission === 'microphone' || permission === 'audioCapture') {
      return true
    }
    return false
  })

  // Allow Web Speech API network access
  mainWin.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    callback({ requestHeaders: details.requestHeaders })
  })

  if (isDev) {
    mainWin.loadURL('http://127.0.0.1:5173')
    mainWin.webContents.openDevTools()
  } else {
    mainWin.loadFile(join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWin.once('ready-to-show', () => {
    mainWin.maximize()
    mainWin.show()
  })

  mainWin.on('minimize', () => {
    if (waveWin && sessionActive) waveWin.show()
  })

  mainWin.on('restore', () => {
    // When restored, hide the wave overlay
    if (waveWin) waveWin.hide()
  })

  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

function createWaveOverlay() {
  waveWin = new BrowserWindow({
    width: 360,
    height: 160,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.js'),
    },
  })

  waveWin.loadFile(join(__dirname, 'wave.html'))

  const display = screen.getPrimaryDisplay()
  const { width, height } = display.workAreaSize
  waveWin.setPosition(Math.round((width - 360) / 2), height - 180)
}

// Show wave overlay when session starts
ipcMain.on('session-started', () => {
  sessionActive = true
  if (!waveWin) return
  if (mainWin && (!mainWin.isVisible() || mainWin.isMinimized())) {
    waveWin.show()
  }
})

ipcMain.on('session-ended', () => {
  sessionActive = false
  if (waveWin) waveWin.hide()
})

// Forward speaking state to wave overlay
ipcMain.on('speaking-state', (_, isSpeaking) => {
  if (waveWin) waveWin.webContents.send('speaking-state', isSpeaking)
})

// End session from wave overlay
ipcMain.on('end-session', () => {
  if (mainWin) mainWin.webContents.send('end-session')
})

/** Reliable open from renderer (timers are not user gestures — avoids silent window.open failures). */
ipcMain.handle('open-external-url', (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) return false
  shell.openExternal(url.trim())
  return true
})

app.whenReady().then(async () => {
  startBackend()
  if (!isDev) {
    try {
      await waitForBackend()
    } catch (err) {
      console.error(err)
    }
  }
  createWindow()
  createWaveOverlay()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (backendProcess) backendProcess.kill()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (backendProcess) backendProcess.kill()
})
