import { exec, ExecException } from 'child_process'
import { globSync } from 'fast-glob'
import { existsSync } from 'fs'
import { mkdir, rm } from 'fs/promises'
import { AppComponents } from '../types'

const outputPath = 'output'
const explorerPath = process.env.EXPLORER_PATH || '.'

export function runDecentralandExplorer(
  { logs }: Pick<AppComponents, 'logs'>,
  extraArgs: string,
  timeout: number
): Promise<{ error: boolean; stderr: string; stdout: string }> {
  const logger = logs.getLogger('godot-snapshot')

  return new Promise(async (resolve) => {
    // Clean the output folder.
    if (existsSync(outputPath)) {
      await rm(outputPath, { recursive: true, force: true })
    }
    await mkdir(outputPath, { recursive: true })

    const command = `${explorerPath}/decentraland.godot.client.x86_64 --rendering-driver opengl3 ${extraArgs}`
    logger.info(
      `about to exec: explorerPath: ${explorerPath}, display: ${process.env.DISPLAY}, command: ${command}, timeout: ${timeout}`
    )

    // This flag ensures we resolve the promise only once.
    let resolved = false

    // Spawn the process in detached mode.
    // We cast the options to 'any' so that TypeScript accepts the 'detached' property.
    const childProcess = exec(
      command,
      { timeout } as any,
      (error: ExecException | null, stdout: string, stderr: string) => {
        if (resolved) return
        clearTimeout(timeoutHandler)
        if (error) {
          // Optionally, clean up core dump files on error.
          for (const f of globSync('core.*')) {
            rm(f).catch(logger.error)
          }
          resolved = true
          return resolve({ error: true, stdout, stderr })
        }
        resolved = true
        resolve({ error: false, stdout, stderr })
      }
    )

    // Allow the child process to run independently.
    childProcess.unref()

    // Save the child's PID.
    const childProcessPid = childProcess.pid

    // Set a failsafe timeout. Using 'const' here as it is assigned only once.
    const timeoutHandler = setTimeout(() => {
      if (childProcessPid !== undefined) {
        try {
          // Kill the entire process group by sending SIGKILL to the negative PID.
          process.kill(-childProcessPid, 'SIGKILL')
        } catch (e: unknown) {
          // Wrap the error so that it matches the logger's expected type.
          if (e instanceof Error) {
            logger.error('Error when killing process group in timeout', { message: e.message })
          } else {
            logger.error('Error when killing process group in timeout', { error: String(e) })
          }
        }
      } else {
        logger.error('childProcess.pid is undefined; cannot kill process group')
      }
      if (!resolved) {
        resolved = true
        resolve({ error: true, stdout: '', stderr: 'timeout' })
      }
    }, timeout + 5000)

    // As an extra guard, listen for the exit event.
    childProcess.on('exit', (code, signal) => {
      if (resolved) return
      clearTimeout(timeoutHandler)
      resolved = true
      resolve({
        error: code !== 0,
        stdout: '',
        stderr: signal ? `Process terminated with signal ${signal}` : ''
      })
    })
  })
}
