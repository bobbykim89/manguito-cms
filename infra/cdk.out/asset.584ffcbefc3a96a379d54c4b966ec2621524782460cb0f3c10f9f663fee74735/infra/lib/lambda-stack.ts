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
 * Deploys the sandbox app's pre-built `dist/` as a Lambda function, invoked
 * directly via a Function URL (no API Gateway — `hono/aws-lambda`'s handle()
 * is compatible with the Function URL payload format).
 *
 * Run `manguito build --env .env` in apps/sandbox before deploying — this
 * stack packages the resulting dist/ as the function code.
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

    const fn = new lambda.Function(this, 'CmsFunction', {
      functionName: 'manguito-cms-sandbox',
      description: 'Manguito CMS sandbox — Lambda deployment test',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../apps/sandbox/dist')),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(30),
      environment: {
        DB_URL: cmsEnv.DB_URL,
        AUTH_SECRET: cmsEnv.AUTH_SECRET,
        S3_BUCKET: cmsEnv.S3_BUCKET,
        ALLOWED_ORIGIN: cmsEnv.ALLOWED_ORIGIN,
        NODE_ENV: 'production',
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
