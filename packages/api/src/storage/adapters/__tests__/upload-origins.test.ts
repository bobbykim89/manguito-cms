import { describe, it, expect } from 'vitest'
import { createS3Adapter } from '../s3'
import { createCloudinaryAdapter } from '../cloudinary'

describe('getUploadOrigins', () => {
  it('S3 returns the virtual-hosted bucket origin', () => {
    const adapter = createS3Adapter({ bucket: 'my-bucket', region: 'us-west-2' })
    expect(adapter.getUploadOrigins?.()).toEqual([
      'https://my-bucket.s3.us-west-2.amazonaws.com',
    ])
  })

  it('Cloudinary returns the api.cloudinary.com upload origin', () => {
    const adapter = createCloudinaryAdapter({ cloud_name: 'demo' })
    expect(adapter.getUploadOrigins?.()).toEqual(['https://api.cloudinary.com'])
  })
})
