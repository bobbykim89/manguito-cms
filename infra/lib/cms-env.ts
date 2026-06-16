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
}
