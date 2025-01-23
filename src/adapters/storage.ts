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
      try {
        const uploadPromises = files.map(async ({ key, filePath }) => {
          const keyWithPrefix = `${formattedPrefix}${key}`
          const fileContent = await readFile(filePath)
          const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: keyWithPrefix,
            Body: fileContent
          })

          return s3Client.send(command)
        })

        await Promise.all(uploadPromises)
        logger.info(`Stored ${files.length} files in S3`)
      } catch (error) {
        logger.error(`Error storing multiple files in S3`)
        logger.error(error as any)
      }
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
