const { app, BrowserWindow, ipcMain, dialog } = require('electron') as any
import { join, dirname } from 'path'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs'
import { createServer, IncomingMessage, ServerResponse } from 'http'
const log = require('electron-log') as any

if (process.platform === 'linux') {
  process.env.GTK_USE_PORTAL = '0'
}

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

function resolveUnityAssetPath(rootDir: string, cleanPath: string) {
  const compressionSuffix = COMPRESSION === 'brotli' ? '.br' : COMPRESSION === 'gzip' ? '.gz' : ''
  const logicalPath = cleanPath.replace(/\.(br|gz)$/i, '')
  const exactPath = join(rootDir, cleanPath)
  const logicalFilePath = join(rootDir, logicalPath)
  const compressedPath =
    compressionSuffix && !cleanPath.toLowerCase().endsWith(compressionSuffix)
      ? join(rootDir, `${cleanPath}${compressionSuffix}`)
      : null

  const candidates = [exactPath]
  if (compressedPath) {
    candidates.push(compressedPath)
  }
  if (logicalFilePath !== exactPath) {
    candidates.push(logicalFilePath)
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const encoding = candidate.endsWith('.br')
        ? 'br'
        : candidate.endsWith('.gz')
          ? 'gzip'
          : undefined
      return { filePath: candidate, logicalPath, encoding }
    }
  }

  return { filePath: exactPath, logicalPath, encoding: undefined as 'br' | 'gzip' | undefined }
}

function detectCompressionFromFiles(fileNames: string[]) {
  const normalized = fileNames.map((name) => name.toLowerCase())

  if (normalized.some((name) => name.endsWith('.br'))) {
    return 'brotli' as const
  }

  if (normalized.some((name) => name.endsWith('.gz'))) {
    return 'gzip' as const
  }

  return 'none' as const
}

function collectRelativeFileNames(rootDir: string, currentDir = rootDir, acc: string[] = []) {
  for (const entry of readdirSync(currentDir)) {
    const fullPath = join(currentDir, entry)
    const stats = statSync(fullPath)

    if (stats.isDirectory()) {
      collectRelativeFileNames(rootDir, fullPath, acc)
      continue
    }

    acc.push(fullPath.slice(rootDir.length + 1).replace(/\\/g, '/'))
  }

  return acc
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
        COMPRESSION = detectCompressionFromFiles(parts.map((part) => part.fileName))

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
        log.info(`Build uploaded: ${ROOT_DIR} (${COMPRESSION})`)
        mainWindow?.webContents.send('build-loaded', {
          rootDir: ROOT_DIR,
          compression: COMPRESSION,
        })

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, compression: COMPRESSION }))
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
      const { filePath: finalFilePath, logicalPath, encoding } = resolveUnityAssetPath(ROOT_DIR, cleanPath)

      if (existsSync(finalFilePath)) {
        const ext = '.' + logicalPath.split('.').pop()?.toLowerCase()
        res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream')

        if (encoding) res.setHeader('Content-Encoding', encoding)

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
  let selectedPath = ''

  try {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory']
    })
    if (!result.canceled && result.filePaths.length > 0) {
      selectedPath = result.filePaths[0]
    }
  } catch (error) {
    log.error('Async open dialog failed:', error)
  }

  if (!selectedPath) {
    const syncPaths = dialog.showOpenDialogSync(mainWindow!, {
      properties: ['openDirectory']
    })
    if (syncPaths && syncPaths.length > 0) {
      selectedPath = syncPaths[0]
    }
  }

  if (selectedPath) {
    ROOT_DIR = selectedPath
    const fileNames = collectRelativeFileNames(ROOT_DIR)
    COMPRESSION = detectCompressionFromFiles(fileNames)
    log.info(`Build selected: ${ROOT_DIR} (${COMPRESSION})`)
    mainWindow?.webContents.send('build-loaded', {
      rootDir: ROOT_DIR,
      compression: COMPRESSION,
    })
    return { success: true, path: ROOT_DIR, compression: COMPRESSION }
  }
  return { success: false }
})

ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Unity Build Folder', extensions: ['html', 'js', 'wasm', 'data'] }]
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, paths: result.filePaths }
  }
  return { success: false }
})

ipcMain.handle('set-root-dir', (_: any, inputPath: string) => {
  if (!inputPath || typeof inputPath !== 'string') {
    return { success: false, error: 'Invalid path.' }
  }

  const trimmed = inputPath.trim()
  if (!trimmed) {
    return { success: false, error: 'Path is empty.' }
  }

  try {
    const stats = statSync(trimmed)
    if (!stats.isDirectory()) {
      return { success: false, error: 'Path is not a directory.' }
    }

    ROOT_DIR = trimmed
    const fileNames = collectRelativeFileNames(ROOT_DIR)
    COMPRESSION = detectCompressionFromFiles(fileNames)
    log.info(`Build path set: ${ROOT_DIR} (${COMPRESSION})`)
    mainWindow?.webContents.send('build-loaded', {
      rootDir: ROOT_DIR,
      compression: COMPRESSION,
    })

    return { success: true, path: ROOT_DIR, compression: COMPRESSION }
  } catch (error) {
    log.error('Failed to set root dir:', error)
    return { success: false, error: 'Path not accessible.' }
  }
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
