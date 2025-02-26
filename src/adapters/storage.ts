import { IBaseComponent } from '@well-known-components/interfaces'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
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

      try {
        const fileContent = await readFile(filePath)
        const command = new PutObjectCommand({
          Bucket: bucketName,
          Key: keyWithPrefix,
          Body: fileContent
        })

        await s3Client.send(command)
        logger.info(`Stored file ${keyWithPrefix} in S3`)
      } catch (error) {
        logger.error(`Error storing file ${keyWithPrefix} in S3`)
        logger.error(error as any)
      }
    },

    storeFiles: async function (files: { key: string; filePath: string }[]) {
      for (const { key, filePath } of files) {
        const keyWithPrefix = `${formattedPrefix}${key}`
        let attempt = 0
        let success = false

        while (attempt < 3 && !success) {
          try {
            // Read the file content
            const fileContent = await readFile(filePath)

            // Create and send the S3 command
            const command = new PutObjectCommand({
              Bucket: bucketName,
              Key: keyWithPrefix,
              Body: fileContent
            })

            await s3Client.send(command)

            // If the command succeeds, log the success and exit the retry loop
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
