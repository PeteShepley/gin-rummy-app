# The GitHub OIDC provider is account-scoped and already created — looked
# up here rather than creating a second one.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "github_deploy_api_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Scoped to a specific repo. Use StringLike with ":*" suffix to allow all branches and events.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${var.github_repo_immutable_token}:*"]
    }
  }
}

resource "aws_iam_role" "github_deploy_api" {
  name               = "github-deploy-gin-rummy-api"
  assume_role_policy = data.aws_iam_policy_document.github_deploy_api_assume.json
}

data "aws_iam_policy_document" "github_deploy_api" {
  statement {
    sid    = "LambdaCodeDeploy"
    effect = "Allow"
    actions = [
      "lambda:UpdateFunctionCode",
      "lambda:GetFunction",
      "lambda:GetFunctionConfiguration",
    ]
    resources = [aws_lambda_function.api.arn]
  }
}

resource "aws_iam_role_policy" "github_deploy_api" {
  name   = "github-deploy-gin-rummy-api"
  role   = aws_iam_role.github_deploy_api.id
  policy = data.aws_iam_policy_document.github_deploy_api.json
}

# Same Lambda-deploy permissions, attached to the consolidated role instead of
# the legacy github_deploy_api one above (see the note on
# data.aws_ssm_parameter.deploy_role_name in main.tf).
resource "aws_iam_role_policy" "gha_deploy_api" {
  name   = "gha-deploy-gin-rummy-api"
  role   = data.aws_ssm_parameter.deploy_role_name.value
  policy = data.aws_iam_policy_document.github_deploy_api.json
}
