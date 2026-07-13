# GitHub Actions OIDC federation. Lets CI assume an AWS role via
# sts:AssumeRoleWithWebIdentity using GitHub's own short-lived tokens, so no
# long-lived AWS access keys ever need to be stored as a repo secret.
resource "aws_iam_openid_connect_provider" "github_actions" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]

  # AWS no longer actually validates this against GitHub's certificate chain
  # (GitHub's CA is in AWS's trusted root store now), the Terraform resource
  # still requires a value, so this is effectively vestigial. Not something to
  # rotate or monitor. Both of GitHub's known intermediate-cert thumbprints
  # are listed since GitHub can return either one.
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]
}

# What GitHub Actions assumes to deploy the backend. The `sub` condition is
# the actual security boundary here, the OIDC provider above is not
# repo-scoped on its own, so a role trusting it without a tight `sub` match
# would let any GitHub repo that discovers this provider's ARN assume it.
# Scoped to exactly this repo + this branch; a PR-triggered workflow would
# need a different `sub` format (repo:...:pull_request), not added since
# nothing here deploys from PRs.
resource "aws_iam_role" "github_actions_deploy" {
  name = "${var.project_name}-github-actions-deploy-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = aws_iam_openid_connect_provider.github_actions.arn }
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:jonathan-nam/maplestorage:ref:refs/heads/master"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_actions_deploy" {
  name = "${var.project_name}-github-actions-deploy-policy"
  role = aws_iam_role.github_actions_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrAuth"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*" # this action doesn't support resource-level scoping
      },
      {
        Sid    = "EcrPush"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:BatchGetImage",
        ]
        Resource = [aws_ecr_repository.backend.arn]
      },
      {
        Sid      = "EcsDescribeAndUpdate"
        Effect   = "Allow"
        Action   = ["ecs:DescribeServices", "ecs:UpdateService"]
        Resource = [aws_ecs_service.backend.id]
      },
      {
        # RegisterTaskDefinition/DescribeTaskDefinition don't support
        # resource-level permissions at all. Confirmed against AWS's IAM
        # reference and an open aws/containers-roadmap issue requesting this
        # as a feature. Resource: "*" is the only option, not an oversight.
        Sid      = "EcsTaskDefinition"
        Effect   = "Allow"
        Action   = ["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition"]
        Resource = "*"
      },
      {
        Sid      = "PassEcsRoles"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = [aws_iam_role.ecs_task_execution.arn, aws_iam_role.ecs_task.arn]
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      },
    ]
  })
}
