import { exec } from 'child_process'
import { globSync } from 'fast-glob'
import { rm } from 'fs/promises'
import { AppComponents } from '../../types'

export type ExecResult = {
  error: boolean
  stderr: string
  stdout: string
}

export function run(components: Pick<AppComponents, 'logs'>, command: string, timeout: number): Promise<ExecResult> {
  const logger = components.logs.getLogger('imposter-runner')

  return new Promise(async (resolve) => {
    logger.info(`about to exec: command: ${command}, timeout: ${timeout}`)

    let resolved = false

    const childProcess = exec(command, { timeout }, (error, stdout, stderr) => {
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
