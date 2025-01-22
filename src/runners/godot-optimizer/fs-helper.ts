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

export function removeExtension(filePath: string): string {
  const lastDotIndex = filePath.lastIndexOf('.')
  // If there's no dot or the dot is part of the path, return the original string
  if (lastDotIndex === -1 || filePath.lastIndexOf('/') > lastDotIndex) {
    return filePath
  }
  return filePath.substring(0, lastDotIndex)
}
