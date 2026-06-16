import * as cdk from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import { Construct } from 'constructs'

/**
 * Creates the IAM managed policy and group for CDK worker users.
 *
 * The single ManguitoCdkWorkerPolicy covers both bootstrap (one-time) and
 * all ongoing cdk deploy runs. Actual resource creation (ECS, Lambda, VPC, etc.)
 * happens via the CloudFormation execution role set up during bootstrap — the
 * worker user needs no service-specific permissions beyond what is here.
 *
 * Usage:
 *   1. cdk deploy IamWorkerStack   (run as an admin user, not the CDK worker)
 *   2. Add your CDK worker IAM user to the manguito-cdk-workers group.
 *   3. Run `cdk bootstrap` once per account/region with the worker credentials.
 *   4. Deploy stacks: `cdk deploy FargateStack`, `cdk deploy LambdaStack`, etc.
 */
export class IamWorkerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const workerPolicy = new iam.ManagedPolicy(this, 'WorkerPolicy', {
      managedPolicyName: 'ManguitoCdkWorkerPolicy',
      description: 'All permissions needed by a CDK worker: bootstrap + deploy',
      statements: [
        new iam.PolicyStatement({
          sid: 'AssumeBootstrapRoles',
          effect: iam.Effect.ALLOW,
          actions: ['sts:AssumeRole'],
          resources: ['arn:aws:iam::*:role/cdk-*'],
        }),
        new iam.PolicyStatement({
          sid: 'CloudFormation',
          effect: iam.Effect.ALLOW,
          actions: ['cloudformation:*'],
          resources: [
            'arn:aws:cloudformation:*:*:stack/CDKToolkit/*',
            'arn:aws:cloudformation:*:*:stack/*/*',
          ],
        }),
        new iam.PolicyStatement({
          sid: 'IamRoles',
          effect: iam.Effect.ALLOW,
          actions: [
            'iam:AttachRolePolicy',
            'iam:CreateRole',
            'iam:DeleteRole',
            'iam:DeleteRolePolicy',
            'iam:DetachRolePolicy',
            'iam:GetRole',
            'iam:GetRolePolicy',
            'iam:PutRolePolicy',
            'iam:TagRole',
            'iam:UntagRole',
            'iam:UpdateRole',
            'iam:UpdateAssumeRolePolicy',
            'iam:UpdateRoleDescription',
          ],
          resources: ['arn:aws:iam::*:role/cdk-*'],
        }),
        new iam.PolicyStatement({
          sid: 'IamPolicies',
          effect: iam.Effect.ALLOW,
          actions: [
            'iam:CreatePolicy',
            'iam:DeletePolicy',
            'iam:GetPolicy',
            'iam:GetPolicyVersion',
            'iam:ListPolicyVersions',
          ],
          resources: ['arn:aws:iam::*:policy/cdk-*'],
        }),
        // PassRole is isolated so the PassedToService condition applies only here.
        // CDK only passes roles to CloudFormation (the cfn-exec-role).
        new iam.PolicyStatement({
          sid: 'IamPassRoleToCfn',
          effect: iam.Effect.ALLOW,
          actions: ['iam:PassRole'],
          resources: ['arn:aws:iam::*:role/cdk-*'],
          conditions: {
            StringEquals: { 'iam:PassedToService': 'cloudformation.amazonaws.com' },
          },
        }),
        new iam.PolicyStatement({
          sid: 'S3Assets',
          effect: iam.Effect.ALLOW,
          actions: ['s3:*'],
          resources: [
            'arn:aws:s3:::cdk-hnb659fds-assets-*',
            'arn:aws:s3:::cdk-hnb659fds-assets-*/*',
          ],
        }),
        // GetAuthorizationToken cannot be scoped to a repository ARN — AWS requires *.
        new iam.PolicyStatement({
          sid: 'EcrAuth',
          effect: iam.Effect.ALLOW,
          actions: ['ecr:GetAuthorizationToken'],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          sid: 'EcrRepository',
          effect: iam.Effect.ALLOW,
          actions: ['ecr:*'],
          resources: ['arn:aws:ecr:*:*:repository/cdk-hnb659fds-container-assets-*'],
        }),
        new iam.PolicyStatement({
          sid: 'SsmBootstrap',
          effect: iam.Effect.ALLOW,
          actions: [
            'ssm:DeleteParameter',
            'ssm:GetParameter',
            'ssm:GetParameters',
            'ssm:PutParameter',
          ],
          resources: ['arn:aws:ssm:*:*:parameter/cdk-bootstrap/hnb659fds/version'],
        }),
      ],
    })

    const workersGroup = new iam.Group(this, 'WorkersGroup', {
      groupName: 'manguito-cdk-workers',
      managedPolicies: [workerPolicy],
    })

    new cdk.CfnOutput(this, 'WorkersGroupName', {
      value: workersGroup.groupName,
      description: 'Add your CDK worker IAM user to this group',
    })
    new cdk.CfnOutput(this, 'WorkerPolicyArn', {
      value: workerPolicy.managedPolicyArn,
      description: 'ManguitoCdkWorkerPolicy ARN',
    })
  }
}
