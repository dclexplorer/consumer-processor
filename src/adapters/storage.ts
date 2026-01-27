import { IBaseComponent } from '@well-known-components/interfaces'
import { S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { createReadStream } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { AppComponents } from '../types'
import { AwsCredentialIdentity } from '@smithy/types'

export type IStorageComponent = IBaseComponent & {
  storeFile(key: string, filePath: string): Promise<void>
  storeFiles(files: { key: string; filePath: string }[]): Promise<void>
}

export async function createS3StorageComponent(
  bucketName: string,
  prefix: string | undefined = undefined,
  endpoint: string | undefined = undefined,
  credentials: AwsCredentialIdentity | undefined = undefined,
  components: Pick<AppComponents, 'logs'>
): Promise<IStorageComponent> {
  const s3Client = new S3Client({
    endpoint,
    forcePathStyle: true,
    credentials
  })
  const logger = components.logs.getLogger('s3-storage')
  const formattedPrefix = prefix ? `${prefix}/` : ''

  return {
    storeFile: async function (key: string, filePath: string) {
      const keyWithPrefix = `${formattedPrefix}${key}`
      let fileStream: ReturnType<typeof createReadStream> | null = null

      try {
        // Use streaming upload to avoid loading entire file into memory
        fileStream = createReadStream(filePath)

        const upload = new Upload({
          client: s3Client,
          params: {
            Bucket: bucketName,
            Key: keyWithPrefix,
            Body: fileStream
          }
        })

        await upload.done()
        logger.info(`Stored file ${keyWithPrefix} in S3`)
      } catch (error) {
        logger.error(`Error storing file ${keyWithPrefix} in S3`)
        logger.error(error as any)
      } finally {
        // Ensure stream is closed
        if (fileStream) {
          fileStream.destroy()
          fileStream = null
        }
      }
    },

    storeFiles: async function (files: { key: string; filePath: string }[]) {
      for (const { key, filePath } of files) {
        const keyWithPrefix = `${formattedPrefix}${key}`
        let attempt = 0
        let success = false

        while (attempt < 3 && !success) {
          let fileStream: ReturnType<typeof createReadStream> | null = null
          try {
            // Use streaming upload to avoid loading entire file into memory
            fileStream = createReadStream(filePath)

            const upload = new Upload({
              client: s3Client,
              params: {
                Bucket: bucketName,
                Key: keyWithPrefix,
                Body: fileStream
              }
            })

            await upload.done()

            // If the upload succeeds, log the success and exit the retry loop
            logger.info(`Successfully stored file ${keyWithPrefix} in S3`)
            success = true
          } catch (error) {
            attempt++

            if (attempt < 3) {
              logger.warn(`Attempt ${attempt} failed for file ${keyWithPrefix}. Retrying...`)
            } else {
              logger.error(`Failed to store file ${keyWithPrefix} after 3 attempts`)
              logger.error(error as any)
            }
          } finally {
            // Ensure stream is closed
            if (fileStream) {
              fileStream.destroy()
              fileStream = null
            }
          }
        }

        // If all attempts fail, throw an error to terminate the process
        if (!success) {
          throw new Error(`Failed to store file ${keyWithPrefix} after 3 attempts`)
        }
      }

      logger.info(`Successfully stored all ${files.length} files in S3`)
    }
  }
}

export function createLocalStorageComponent(
  baseDir: string,
  components: Pick<AppComponents, 'logs'>
): IStorageComponent {
  const logger = components.logs.getLogger('local-storage')
  return {
    storeFile: async function (key: string, filePath: string) {
      try {
        const fileContent = await readFile(filePath)
        const dirName = path.dirname(path.join(baseDir, key))
        await mkdir(dirName, { recursive: true })
        await writeFile(path.join(baseDir, key), fileContent)
        logger.info(`Stored file ${key} in local storage`)
      } catch (error) {
        logger.error(`Error storing file ${key} in local storage`)
        logger.error(error as any)
      }
    },

    storeFiles: async function (files: { key: string; filePath: string }[]) {
      for (const { key, filePath } of files) {
        await this.storeFile(key, filePath)
      }
    }
  }
}
