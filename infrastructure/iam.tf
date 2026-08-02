data "aws_iam_policy_document" "github_deploy_api" {
  statement {
    sid    = "LambdaCodeDeploy"
    effect = "Allow"
    actions = [
      "lambda:UpdateFunctionCode",
      "lambda:GetFunction",
      "lambda:GetFunctionConfiguration",
    ]
    # The same consolidated deploy role updates both Lambdas' code: the HTTP
    # API (deploy-api.yml) and the WebSocket relay (deploy-relay.yml).
    resources = [aws_lambda_function.api.arn, aws_lambda_function.relay.arn]
  }
}

# Attached to the consolidated role (data.aws_ssm_parameter.deploy_role_name
# in main.tf) — web.tf attaches this repo's other policy (S3/CloudFront
# deploy) to the same role.
resource "aws_iam_role_policy" "gha_deploy_api" {
  name   = "gha-deploy-gin-rummy-api"
  role   = data.aws_ssm_parameter.deploy_role_name.value
  policy = data.aws_iam_policy_document.github_deploy_api.json
}
