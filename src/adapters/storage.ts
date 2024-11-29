import { IBaseComponent } from '@well-known-components/interfaces'
import AWS from 'aws-sdk'
import { readFile, writeFile } from 'fs/promises'

export type IStorageComponent = IBaseComponent & {
  storeFile(key: string, filePath: string): Promise<void>
}

export async function createS3StorageComponent(
  bucketName: string,
  endpoint: string | undefined = undefined
): Promise<IStorageComponent> {
  const s3 = new AWS.S3({
    endpoint,
    s3ForcePathStyle: true
  })
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

        // Upload to S3
        const result = await s3.upload(params).promise()
        console.log('File uploaded successfully:', result)
      } catch (error) {
        console.error('Error uploading file:', error)
      }
    }
  }
}

export function createLocalStorageComponent(): IStorageComponent {
  return {
    storeFile: async function (key: string, filePath: string) {
      try {
        // Read file content
        const fileContent = await readFile(filePath)

        await writeFile(key, fileContent)
        console.log('File copied successfully:')
      } catch (error) {
        console.error('Error copying file:', error)
      }
    }
  }
}
