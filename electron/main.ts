import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, dirname } from 'path'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { createServer, IncomingMessage, ServerResponse } from 'http'
import log from 'electron-log'

log.transports.file.level = 'info'
log.transports.console.level = 'info'

let mainWindow: BrowserWindow | null = null
let server: ReturnType<typeof createServer> | null = null
let ROOT_DIR = ''
let COMPRESSION: 'none' | 'gzip' | 'brotli' = 'none'
let serverPort = 8000

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#0f0f0f',
    show: false,
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }
}

function startServer() {
  if (server) {
    server.close()
  }

  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost:${serverPort}`)
    const pathname = url.pathname

    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    if (pathname === '/upload' && req.method === 'POST') {
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(chunk)
      }
      const body = Buffer.concat(chunks).toString()
      const boundary = req.headers['content-type']?.split('boundary=')[1]

      if (!boundary) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'No boundary' }));
        return
      }

      const parts = body.split(`--${boundary}`).filter(p => p.trim() && !p.trim().startsWith('--'))
      const buildFolder = `build_${Date.now()}`
      const uploadBase = join(app.getPath('userData'), 'uploads', buildFolder)

      for (const part of parts) {
        const match = part.match(/filename="([^"]+)"/)
        if (match) {
          let fileName = match[1]
          const contentMatch = part.split('\r\n\r\n')
          if (contentMatch.length > 1) {
            const content = contentMatch[contentMatch.length - 1]
            const parts2 = fileName.split('/')
            fileName = parts2.length > 1 ? parts2.slice(1).join('/') : fileName
            const dest = join(uploadBase, fileName)
            const destDir = dirname(dest)
            if (!existsSync(destDir)) {
              mkdirSync(destDir, { recursive: true })
            }
            writeFileSync(dest, content)
          }
        }
      }

      ROOT_DIR = uploadBase
      log.info(`Build uploaded: ${ROOT_DIR}`)
      mainWindow?.webContents.send('build-loaded', ROOT_DIR)

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true }));
      return
    }

    if (pathname === '/set-compression') {
      const type = url.searchParams.get('type')
      if (type === 'gzip' || type === 'brotli' || type === 'none') {
        COMPRESSION = type
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end(`Compression: ${COMPRESSION}`)
      return
    }

    if (pathname === '/server-status') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ port: serverPort, running: true, rootDir: ROOT_DIR }));
      return
    }

    const isIframe = req.headers['sec-fetch-dest'] === 'iframe' || url.searchParams.has('t')

    if (!isIframe) {
      const requestedFile = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '')
      const publicFile = join(__dirname, '..', 'public', requestedFile)
      if (existsSync(publicFile)) {
        const ext = '.' + requestedFile.split('.').pop()?.toLowerCase()
        res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream')
        res.writeHead(200)
        res.end(readFileSync(publicFile))
        return
      }
    }

    if (!ROOT_DIR) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('404: No build uploaded.')
      return
    }

    const cleanPath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '')
    const finalFilePath = join(ROOT_DIR, cleanPath)

    if (existsSync(finalFilePath)) {
      const ext = '.' + cleanPath.split('.').pop()?.toLowerCase()
      res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream')

      if (COMPRESSION === 'gzip') res.setHeader('Content-Encoding', 'gzip')
      if (COMPRESSION === 'brotli') res.setHeader('Content-Encoding', 'br')

      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')

      res.writeHead(200)
      res.end(readFileSync(finalFilePath))
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end(`404: File not found at ${cleanPath}`)
  })

  server.listen(serverPort, () => {
    log.info(`Server running at http://localhost:${serverPort}`)
    mainWindow?.webContents.send('server-started', serverPort)
  })
}

ipcMain.handle('get-server-status', () => {
  return { port: serverPort, running: true, rootDir: ROOT_DIR }
})

ipcMain.handle('set-compression', (_, type: string) => {
  if (type === 'gzip' || type === 'brotli' || type === 'none') {
    COMPRESSION = type
    return { success: true, compression: COMPRESSION }
  }
  return { success: false }
})

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory']
  })
  if (!result.canceled && result.filePaths.length > 0) {
    ROOT_DIR = result.filePaths[0]
    return { success: true, path: ROOT_DIR }
  }
  return { success: false }
})

ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Unity Build Files', extensions: ['html', 'js', 'wasm', 'data'] }]
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, paths: result.filePaths }
  }
  return { success: false }
})

ipcMain.handle('get-game-url', () => {
  return `http://localhost:${serverPort}/`
})

app.whenReady().then(() => {
  log.info('App starting...')
  createWindow()
  startServer()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (server) server.close()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error)
})

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection:', reason)
})