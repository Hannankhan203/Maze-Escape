import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const testDir = path.resolve('src/game/three')
const testFiles = fs
  .readdirSync(testDir)
  .filter((name) => /^test.*\.js$/.test(name))
  .sort((a, b) => a.localeCompare(b))

if (testFiles.length === 0) {
  console.error('No test*.js files found under src/game/three')
  process.exit(1)
}

console.log(`Discovered ${testFiles.length} test suites in src/game/three:\n`)

const passed = []
const failed = []

for (const fileName of testFiles) {
  const relPath = path.join('src/game/three', fileName)
  console.log(`\n==============================`)
  console.log(`Running ${relPath}`)
  console.log(`==============================`)

  const result = spawnSync(process.execPath, [relPath], {
    stdio: 'inherit',
  })

  if (result.error) {
    console.error(`Error executing ${relPath}:`, result.error.message)
    failed.push({ fileName, code: 1, signal: null })
  } else if (result.status !== 0) {
    console.error(
      `Suite FAILED: ${relPath} (exit=${result.status}, signal=${result.signal || 'none'})`
    )
    failed.push({
      fileName,
      code: result.status,
      signal: result.signal || null,
    })
  } else {
    passed.push(fileName)
  }
}

console.log(`\n==============================`)
console.log(
  `Test Summary: ${passed.length}/${testFiles.length} suites passed`
)
if (failed.length > 0) {
  console.error(
    `Failed suites (${failed.length}): ${failed.map((f) => f.fileName).join(', ')}`
  )
  process.exitCode = 1
} else {
  console.log('All test suites passed.')
}
