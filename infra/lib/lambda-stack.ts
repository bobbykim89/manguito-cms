import * as path from 'node:path'
import * as cdk from 'aws-cdk-lib'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as s3 from 'aws-cdk-lib/aws-s3'
import { Construct } from 'constructs'
import type { CmsEnv } from './cms-env'

export type LambdaStackProps = cdk.StackProps & {
  cmsEnv: CmsEnv
}

/**
 * Deploys the sandbox app as a container-image Lambda function, invoked
 * directly via a Function URL (no API Gateway — `hono/aws-lambda`'s handle()
 * is compatible with the Function URL payload format).
 *
 * Built from the repo-root Dockerfile's `lambda` target — `dist/handler.js`
 * imports workspace packages directly rather than bundling them, so the
 * function needs a real node_modules with them resolved (same reason
 * Fargate needs the multi-stage build). A zip-based Lambda with just
 * `pnpm deploy --prod` output was tried first but came out to ~298MB, over
 * Lambda's 250MB unzipped limit, since this pnpm version doesn't fully
 * exclude devDependencies under force-legacy-deploy. The `public.ecr.aws/
 * lambda/nodejs:22` base image used by the `lambda` Docker target carries
 * the Lambda Runtime Interface Client needed to run as a Lambda function.
 *
 * No VPC: the CMS talks to Neon (HTTP-reachable Postgres) and S3 (the AWS
 * SDK reaches it over the public S3 endpoint), so there is no private
 * resource to reach.
 *
 * Storage credentials: deliberately NOT passed as AWS_ACCESS_KEY_ID /
 * AWS_SECRET_ACCESS_KEY env vars — the S3 adapter falls back to the default
 * credential provider chain, so the function's execution role (granted
 * write access to the bucket below) is used instead. AWS_REGION is also
 * omitted: Lambda reserves and auto-populates it with the function's
 * deployed region.
 */
export class LambdaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props)

    const { cmsEnv } = props
    const repoRoot = path.join(__dirname, '../..')

    const fn = new lambda.DockerImageFunction(this, 'CmsFunction', {
      functionName: 'manguito-cms-sandbox',
      description: 'Manguito CMS sandbox — Lambda deployment test',
      architecture: lambda.Architecture.X86_64,
      code: lambda.DockerImageCode.fromImageAsset(repoRoot, {
        file: 'Dockerfile',
        target: 'lambda',
      }),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(30),
      environment: {
        DB_URL: cmsEnv.DB_URL,
        AUTH_SECRET: cmsEnv.AUTH_SECRET,
        S3_BUCKET: cmsEnv.S3_BUCKET,
        ALLOWED_ORIGIN: cmsEnv.ALLOWED_ORIGIN,
        NODE_ENV: 'production',
        // Cloudinary storage — passed through only when configured.
        ...(cmsEnv.CLOUDINARY_CLOUD_NAME ? { CLOUDINARY_CLOUD_NAME: cmsEnv.CLOUDINARY_CLOUD_NAME } : {}),
        ...(cmsEnv.CLOUDINARY_API_KEY ? { CLOUDINARY_API_KEY: cmsEnv.CLOUDINARY_API_KEY } : {}),
        ...(cmsEnv.CLOUDINARY_API_SECRET ? { CLOUDINARY_API_SECRET: cmsEnv.CLOUDINARY_API_SECRET } : {}),
      },
    })

    const bucket = s3.Bucket.fromBucketName(this, 'SandboxBucket', cmsEnv.S3_BUCKET)
    bucket.grantWrite(fn)

    const functionUrl = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: [cmsEnv.ALLOWED_ORIGIN],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['*'],
      },
    })

    new cdk.CfnOutput(this, 'FunctionUrl', {
      value: functionUrl.url,
      description: 'Public URL for the Manguito CMS Lambda deployment',
    })
  }
}
