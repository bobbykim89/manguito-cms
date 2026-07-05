import * as path from 'node:path'
import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import { Construct } from 'constructs'
import type { CmsEnv } from './cms-env'

export type FargateStackProps = cdk.StackProps & {
  cmsEnv: CmsEnv
}

/**
 * Deploys the sandbox app as a load-balanced Fargate service, built from the
 * monorepo-root Dockerfile (the image needs the workspace packages resolved
 * via `pnpm deploy`, so the Docker build context must be the repo root).
 *
 * No NAT gateways: the VPC has public subnets only and tasks get public IPs
 * for outbound access to Neon/S3 — there's no private resource to reach, so
 * a NAT gateway would just add cost.
 *
 * Storage credentials: deliberately NOT passed as AWS_ACCESS_KEY_ID /
 * AWS_SECRET_ACCESS_KEY env vars — the S3 adapter falls back to the default
 * credential provider chain, so the task role (granted write access to the
 * bucket below) is used instead. Unlike Lambda, ECS does not auto-populate
 * AWS_REGION, so it's passed through explicitly.
 */
export class FargateStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FargateStackProps) {
    super(scope, id, props)

    const { cmsEnv } = props

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    })

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: 'manguito-cms-sandbox',
    })

    const repoRoot = path.join(__dirname, '../..')

    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster,
      cpu: 256,
      memoryLimitMiB: 512,
      desiredCount: 1,
      assignPublicIp: true,
      taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset(repoRoot, { file: 'Dockerfile', target: 'fargate' }),
        containerPort: 3000,
        environment: {
          DB_URL: cmsEnv.DB_URL,
          AUTH_SECRET: cmsEnv.AUTH_SECRET,
          S3_BUCKET: cmsEnv.S3_BUCKET,
          AWS_REGION: cmsEnv.AWS_REGION,
          ALLOWED_ORIGIN: cmsEnv.ALLOWED_ORIGIN,
          NODE_ENV: 'production',
          // Cloudinary storage — passed through only when configured.
          ...(cmsEnv.CLOUDINARY_CLOUD_NAME ? { CLOUDINARY_CLOUD_NAME: cmsEnv.CLOUDINARY_CLOUD_NAME } : {}),
          ...(cmsEnv.CLOUDINARY_API_KEY ? { CLOUDINARY_API_KEY: cmsEnv.CLOUDINARY_API_KEY } : {}),
          ...(cmsEnv.CLOUDINARY_API_SECRET ? { CLOUDINARY_API_SECRET: cmsEnv.CLOUDINARY_API_SECRET } : {}),
          PORT: '3000',
        },
      },
    })

    const bucket = s3.Bucket.fromBucketName(this, 'SandboxBucket', cmsEnv.S3_BUCKET)
    bucket.grantWrite(service.taskDefinition.taskRole)

    service.targetGroup.configureHealthCheck({
      path: '/api/openapi.json',
      healthyHttpCodes: '200-399',
    })

    // CloudFront sits in front of the ALB to provide HTTPS termination.
    // The app sets cookies with Secure:true — browsers only accept those over
    // HTTPS, so without this the login flow silently drops Set-Cookie.
    //
    // Caching is disabled entirely: every request must reach the origin since
    // the CMS is a fully dynamic API + admin panel. ALL_VIEWER_EXCEPT_HOST_HEADER
    // forwards all headers/cookies/query-strings except Host (the ALB expects
    // its own DNS name, not the CloudFront domain, in the Host header).
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new origins.HttpOrigin(service.loadBalancer.loadBalancerDnsName, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS,
      },
    })

    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'HTTPS URL for the Manguito CMS Fargate deployment (use this, not the ALB URL)',
    })

    new cdk.CfnOutput(this, 'LoadBalancerUrl', {
      value: `http://${service.loadBalancer.loadBalancerDnsName}`,
      description: 'Raw ALB URL (HTTP only — use CloudFrontUrl for the admin panel)',
    })
  }
}
