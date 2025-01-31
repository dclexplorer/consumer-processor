import fs, { stat } from 'fs/promises'
import path from 'path'

type ImageFormat = 'png' | 'svg' | 'jpeg' | 'gif' | 'unknown'

type Format = ImageFormat | string

async function detectFormatByContent(filePath: string): Promise<ImageFormat> {
  try {
    const fileHandle = await fs.open(filePath, 'r')
    const buffer = Buffer.alloc(8) // Read up to 8 bytes (longest signature)
    await fileHandle.read(buffer, 0, 8, 0)
    await fileHandle.close()

    // Check for PNG signature: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return 'png'
    }

    // Check for JPEG signature: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'jpeg'
    }

    // Check for GIF signature: GIF87a or GIF89a
    if (
      buffer[0] === 0x47 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x38 &&
      (buffer[4] === 0x37 || buffer[4] === 0x39) &&
      buffer[5] === 0x61
    ) {
      return 'gif'
    }

    // Check for SVG content: starts with <svg
    const textContent = buffer.toString('utf8').trim()
    if (textContent.startsWith('<svg')) {
      return 'svg'
    }

    return 'unknown'
  } catch (error) {
    console.error('Error detecting format by content:', error)
    return 'unknown'
  }
}

export async function detectFormat(filePath: string, originalPath: string): Promise<Format> {
  const contentFormat = await detectFormatByContent(filePath)
  if (contentFormat !== 'unknown') {
    return contentFormat
  }

  // Fallback to file extension if content detection fails
  const extension = path.extname(originalPath).toLowerCase().replace('.', '')
  return extension || 'unknown'
}

export function isImageFormat(filePath: string): boolean {
  if (!filePath) {
    return false // Handle empty or undefined filePath
  }
  const extension = path.extname(filePath).toLowerCase().slice(1) // Remove leading dot
  const imageFormats = ['png', 'svg', 'jpeg', 'jpg', 'gif']
  return imageFormats.includes(extension)
}

export async function getFileSizeAsync(filePath: string): Promise<number> {
  try {
    const stats = await stat(filePath)
    return stats.size
  } catch (error) {
    console.error('Error reading file:', error)
    return -1
  }
}
