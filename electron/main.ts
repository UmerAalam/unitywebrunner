const { app, BrowserWindow, ipcMain, dialog } = require('electron') as any
import { join, dirname } from 'path'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { createServer, IncomingMessage, ServerResponse } from 'http'
const log = require('electron-log') as any

log.transports.file.level = 'info'
log.transports.console.level = 'info'

let mainWindow: any = null
let server: ReturnType<typeof createServer> | null = null
let ROOT_DIR = ''
let COMPRESSION: 'none' | 'gzip' | 'brotli' = 'none'
let serverPort = 0
const SERVER_HOST = '127.0.0.1'

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

  mainWindow.loadURL(`http://${SERVER_HOST}:${serverPort}/`)
}

function indexOfBuffer(haystack: Buffer, needle: Buffer, start = 0) {
  return haystack.indexOf(needle, start)
}

function getCommonUploadPrefix(fileNames: string[]) {
  if (fileNames.length === 0) {
    return null
  }

  const firstSegments = fileNames.map((name) => name.split('/')[0])
  const first = firstSegments[0]

  if (!first || firstSegments.some((segment) => segment !== first)) {
    return null
  }

  const prefix = `${first}/`
  return fileNames.every((name) => name.startsWith(prefix)) ? first : null
}

function parseMultipartBody(body: Buffer, boundary: string) {
  const boundaryMarker = Buffer.from(`--${boundary}`)
  const headerSeparator = Buffer.from('\r\n\r\n')
  const entries: Array<{ fileName: string; content: Buffer }> = []

  let cursor = 0
  while (cursor < body.length) {
    const boundaryStart = indexOfBuffer(body, boundaryMarker, cursor)
    if (boundaryStart === -1) {
      break
    }

    const partStart = boundaryStart + boundaryMarker.length
    const nextBoundary = indexOfBuffer(body, boundaryMarker, partStart)
    if (nextBoundary === -1) {
      break
    }

    const part = body.subarray(partStart, nextBoundary)
    cursor = nextBoundary

    const headerStart = part.indexOf(headerSeparator)
    if (headerStart === -1) {
      continue
    }

    const headerText = part.subarray(0, headerStart).toString('utf8')
    const filenameMatch = headerText.match(/filename="([^"]+)"/)
    if (!filenameMatch) {
      continue
    }

    let content = part.subarray(headerStart + headerSeparator.length)
    if (content.length >= 2 && content[content.length - 2] === 13 && content[content.length - 1] === 10) {
      content = content.subarray(0, content.length - 2)
    }

    entries.push({ fileName: filenameMatch[1], content })
  }

  return entries
}

function startServer() {
  return new Promise<number>((resolve, reject) => {
    if (server) {
      server.close()
      server = null
    }

    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://${SERVER_HOST}:${serverPort}`)
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
        const body = Buffer.concat(chunks)
        const boundary = req.headers['content-type']?.split('boundary=')[1]

        if (!boundary) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'No boundary' }))
          return
        }

        const parts = parseMultipartBody(body, boundary)
        const buildFolder = `build_${Date.now()}`
        const uploadBase = join(app.getPath('userData'), 'uploads', buildFolder)
        const stripPrefix = getCommonUploadPrefix(parts.map((part) => part.fileName))

        for (const part of parts) {
          let fileName = part.fileName.replace(/^\.\/+/, '')
          if (stripPrefix && fileName.startsWith(`${stripPrefix}/`)) {
            fileName = fileName.slice(stripPrefix.length + 1)
          }

          const dest = join(uploadBase, fileName)
          const destDir = dirname(dest)
          if (!existsSync(destDir)) {
            mkdirSync(destDir, { recursive: true })
          }
          writeFileSync(dest, part.content)
        }

        ROOT_DIR = uploadBase
        log.info(`Build uploaded: ${ROOT_DIR}`)
        mainWindow?.webContents.send('build-loaded', ROOT_DIR)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
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
        res.end(JSON.stringify({ port: serverPort, running: true, rootDir: ROOT_DIR }))
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

    server.once('error', reject)
    server.listen(0, SERVER_HOST, () => {
      const address = server?.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to determine Electron server port'))
        return
      }

      serverPort = address.port
      log.info(`Server running at http://${SERVER_HOST}:${serverPort}`)
      resolve(serverPort)
    })
  })
}

ipcMain.handle('get-server-status', () => {
  return { port: serverPort, running: true, rootDir: ROOT_DIR }
})

ipcMain.handle('set-compression', (_: any, type: string) => {
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
  return `http://${SERVER_HOST}:${serverPort}/`
})

app.whenReady().then(async () => {
  log.info('App starting...')

  try {
    await startServer()
  } catch (error) {
    log.error('Failed to start server:', error)
    app.quit()
    return
  }

  createWindow()

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
