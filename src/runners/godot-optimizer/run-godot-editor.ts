import { exec, ExecException } from 'child_process'
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

    // Execute the command via exec (which spawns a shell)
    const childProcess = exec(
      command,
      { cwd, timeout } as any,
      (error: ExecException | null, stdout: string, stderr: string) => {
        if (resolved) return
        clearTimeout(timeoutHandler)
        if (error) {
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

    // Let the child process run independently.
    childProcess.unref()

    // Save the child's PID.
    const childProcessPid = childProcess.pid

    // Helper: Kill all processes whose command line matches the Godot editor binary.
    const killProcessTree = () => {
      // Using pkill to kill any process matching the godotEditorPath.
      // Adjust the match pattern if needed.
      const pkillCommand = `pkill -9 -f "${godotEditorPath}"`
      exec(pkillCommand, (err, stdout, stderr) => {
        if (err) {
          // pkill returns code 1 if no process was matched; ignore that.
          if ((err as any).code !== 1) {
            logger.error('Error executing pkill for godot process tree', {
              message: (err as Error).message
            })
          }
        }
      })
    }

    // Helper function to kill the process group and the process tree.
    const killProcessGroup = () => {
      if (childProcessPid !== undefined) {
        try {
          // Attempt to kill the entire process group (using a negative PID).
          process.kill(-childProcessPid, 'SIGKILL')
        } catch (e: unknown) {
          if (e instanceof Error && (e as any).code === 'ESRCH') {
            // Process group already terminated.
          } else if (e instanceof Error) {
            logger.error('Error when killing process group', { message: e.message })
          } else {
            logger.error('Error when killing process group', { error: String(e) })
          }
        }
      } else {
        logger.error('childProcess.pid is undefined; cannot kill process group')
      }
      // Additionally, run pkill to catch any stray Godot processes.
      killProcessTree()
    }

    // Listen for the exit event as a backup.
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

    // Listen for the close event; if SIGTERM is received, kill the process group.
    childProcess.on('close', (_code, signal) => {
      if (signal === 'SIGTERM') {
        killProcessGroup()
      }
    })

    // Set a failsafe timeout that will kill the process group if the command hasn't finished.
    const timeoutHandler = setTimeout(() => {
      killProcessGroup()
      if (!resolved) {
        resolved = true
        resolve({ error: true, stdout: '', stderr: 'timeout' })
      }
    }, timeout + 5000)
  })
}
