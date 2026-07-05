#!/usr/bin/env node
import * as dotenv from 'dotenv'
import * as cdk from 'aws-cdk-lib'
import { IamWorkerStack } from '../lib/iam-worker-stack'
import { LambdaStack } from '../lib/lambda-stack'
import { FargateStack } from '../lib/fargate-stack'
import type { CmsEnv } from '../lib/cms-env'

dotenv.config()

function requireEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`Missing required env var ${name} — copy infra/.env.example to infra/.env and fill it in`)
  }
  return value
}

const app = new cdk.App()

const env = {
  account: process.env['CDK_DEFAULT_ACCOUNT'],
  region: process.env['CDK_DEFAULT_REGION'],
}

new IamWorkerStack(app, 'IamWorkerStack', {
  description: 'IAM policies and group for Manguito CMS CDK workers',
  env,
})

// Lambda and Fargate stacks deploy the sandbox app for live deployment testing.
// They require infra/.env (see infra/.env.example) — only constructed when the
// required vars are present, so `cdk list` / `cdk synth IamWorkerStack` work
// without it.
if (process.env['DB_URL'] !== undefined) {
  const cmsEnv: CmsEnv = {
    DB_URL: requireEnv('DB_URL'),
    AUTH_SECRET: requireEnv('AUTH_SECRET'),
    S3_BUCKET: requireEnv('S3_BUCKET'),
    AWS_REGION: requireEnv('AWS_REGION'),
    ALLOWED_ORIGIN: process.env['ALLOWED_ORIGIN'] ?? '*',
    // Optional — passed through only when set (Cloudinary storage).
    CLOUDINARY_CLOUD_NAME: process.env['CLOUDINARY_CLOUD_NAME'],
    CLOUDINARY_API_KEY: process.env['CLOUDINARY_API_KEY'],
    CLOUDINARY_API_SECRET: process.env['CLOUDINARY_API_SECRET'],
  }

  new LambdaStack(app, 'LambdaStack', {
    description: 'Manguito CMS sandbox — Lambda deployment test',
    env,
    cmsEnv,
  })

  new FargateStack(app, 'FargateStack', {
    description: 'Manguito CMS sandbox — Fargate deployment test',
    env,
    cmsEnv,
  })
}
