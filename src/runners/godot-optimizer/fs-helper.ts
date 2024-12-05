import fs from 'fs/promises'

export async function fileExists(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile()
  } catch (e) {
    return false
  }
}

export async function dirExists(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory()
  } catch (e) {
    return false
  }
}
