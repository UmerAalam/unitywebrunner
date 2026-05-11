const { copyFileSync, existsSync, mkdirSync } = require('fs')
const { join } = require('path')

const source = join(process.cwd(), 'node_modules', 'lucide', 'dist', 'umd', 'lucide.js')
const targetDir = join(process.cwd(), 'public', 'vendor')
const target = join(targetDir, 'lucide.js')

if (!existsSync(source)) {
  throw new Error(`Lucide bundle not found at ${source}`)
}

if (!existsSync(targetDir)) {
  mkdirSync(targetDir, { recursive: true })
}

copyFileSync(source, target)
console.log(`Synced ${target}`)
