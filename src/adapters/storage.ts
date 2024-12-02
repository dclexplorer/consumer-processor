import { IBaseComponent } from '@well-known-components/interfaces'
import AWS from 'aws-sdk'
import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { AppComponents } from '../types'

export type IStorageComponent = IBaseComponent & {
  storeFile(key: string, filePath: string): Promise<void>
}

export async function createS3StorageComponent(
  bucketName: string,
  endpoint: string | undefined = undefined,
  components: Pick<AppComponents, 'logs'>
): Promise<IStorageComponent> {
  const s3 = new AWS.S3({
    endpoint,
    s3ForcePathStyle: true
  })
  const logger = components.logs.getLogger('s3-storage')
  return {
    storeFile: async function (key: string, filePath: string) {
      try {
        // Read file content
        const fileContent = await readFile(filePath)

        // Parameters for the upload
        const params = {
          Bucket: bucketName,
          Key: key, // File name (key) in the bucket
          Body: fileContent // File content
        }

        // TODO: add logs
        // Upload to S3
        await s3.upload(params).promise()
        logger.info(`Stored file ${key} in S3`)
      } catch (error) {
        logger.error(`Error storing file ${key} in S3`)
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
        // Read file content
        const fileContent = await readFile(filePath)

        const dirName = path.dirname(path.join(baseDir, key))
        await mkdir(dirName, { recursive: true })
        await writeFile(path.join(baseDir, key), fileContent)
        logger.info(`Stored file ${key} in local storage`)
      } catch (error) {
        logger.error(`Error storing file ${key} in local storage`)
        logger.error(error as any)
      }
    }
  }
}
