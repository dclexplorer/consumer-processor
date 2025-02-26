import fs, { readdir } from 'fs/promises'
import { join } from 'path'

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

export async function listFilesInFolder(folderPath: string): Promise<string[]> {
  try {
    const entries = await readdir(folderPath, { withFileTypes: true })
    const files = entries
      .filter((entry) => entry.isFile()) // Filter out only files
      .map((file) => join(folderPath, file.name)) // Map to full paths
    return files
  } catch (error) {
    console.error(`Error reading folder: ${folderPath}`, error)
    throw error
  }
}
