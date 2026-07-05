/**
 * Runtime environment variables required by the Manguito CMS sandbox app.
 *
 * Sourced from infra/.env (gitignored) and passed straight through as plain
 * environment variables to the Lambda function / Fargate task. Fine for a
 * testing setup — production deployments should graduate to Secrets Manager
 * + a runtime-fetch pattern instead of embedding values in the stack.
 */
export type CmsEnv = {
  DB_URL: string
  AUTH_SECRET: string
  S3_BUCKET: string
  AWS_REGION: string
  ALLOWED_ORIGIN: string
  // Optional — only needed when the app uses the Cloudinary storage adapter.
  // Harmless alongside S3: the config selects one adapter, and each reads only
  // its own vars, so unused ones are ignored.
  CLOUDINARY_CLOUD_NAME?: string
  CLOUDINARY_API_KEY?: string
  CLOUDINARY_API_SECRET?: string
}
