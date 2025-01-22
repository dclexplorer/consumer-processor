import { exec } from 'child_process'
import { globSync } from 'fast-glob'
import { rm } from 'fs/promises'
import { AppComponents } from '../../types'

export type GodotEditorResult = {
  error: boolean
  stderr: string
  stdout: string
}

export function runGodotEditor(
  godotEditorPath: string,
  cwd: string,
  components: Pick<AppComponents, 'logs'>,
  args: string[],
  timeout: number
): Promise<GodotEditorResult> {
  const logger = components.logs.getLogger('godot-editor')

  return new Promise(async (resolve) => {
    const command = `${godotEditorPath} --rendering-driver opengl3 ${args.join(' ')}`
    logger.info(
      `about to exec: godotEditorPath: ${godotEditorPath}, display: ${process.env.DISPLAY}, command: ${command}, timeout: ${timeout}`
    )

    let resolved = false

    const childProcess = exec(command, { cwd, timeout }, (error, stdout, stderr) => {
      if (resolved) {
        return
      }

      if (error) {
        for (const f of globSync('core.*')) {
          rm(f).catch(logger.error)
        }
        resolved = true
        return resolve({ error: true, stdout, stderr })
      }
      resolved = true
      resolve({ error: false, stdout, stderr })
    })

    const childProcessPid = childProcess.pid

    childProcess.on('close', (_code, signal) => {
      // timeout sends SIGTERM, we might want to kill it harder
      if (signal === 'SIGTERM') {
        childProcess.kill('SIGKILL')
      }
    })

    setTimeout(() => {
      exec(`kill -9 ${childProcessPid}`, () => {})
      if (!resolved) {
        resolve({ error: true, stdout: '', stderr: 'timeout' })
        resolved = true
      }
    }, timeout + 5_000)
  })
}

export function cleanZipFileFromGodotGarbage(zipFilePath: string): void {
  const filesToRemove = ['project.binary', '.godot/global_script_class_cache.cfg', '.godot/uid_cache.bin']
  // Construct the `zip -d` command
  const files = filesToRemove.map((file) => `"${file}"`).join(' ')
  const command = `zip -d ${zipFilePath} ${files}`

  console.log(`Executing command: ${command}`)

  // Execute the command
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error('Error executing command:', error.message)
      return
    }

    // Log the command output
    if (stdout) console.log('Command Output:', stdout)
    if (stderr) console.error('Command Errors:', stderr)

    console.log('Files removed successfully.')
  })
}
