# Static hosting for clients/web (S3 + CloudFront + its own GitHub OIDC
# deploy role), provisioned via the shared module. Referenced by local
# relative path since this repo and terraform-aws-static-app are checked
# out as sibling directories on this developer's machine.
module "web" {
  source = "github.com/PeteShepley/terraform-aws-static-app"

  app_name             = "gin-rummy-app"
  site_bucket_name     = var.site_bucket_name
  domain_name          = var.domain_name
  root_domain_name     = var.root_domain_name
  distribution_comment = "gin-rummy-app (${var.domain_name})"
  github_repo          = var.github_repo
}

# Same S3/CloudFront deploy permissions the module grants its own role,
# attached to the consolidated role instead (see the note on
# data.aws_ssm_parameter.deploy_role_name in main.tf).
data "aws_iam_policy_document" "gha_deploy_web" {
  statement {
    sid    = "S3SiteSync"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
      "s3:ListBucket",
    ]
    resources = [
      module.web.site_bucket_arn,
      "${module.web.site_bucket_arn}/*",
    ]
  }

  statement {
    sid       = "CloudFrontInvalidation"
    effect    = "Allow"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [module.web.cloudfront_distribution_arn]
  }
}

resource "aws_iam_role_policy" "gha_deploy_web" {
  name   = "gha-deploy-gin-rummy-web"
  role   = data.aws_ssm_parameter.deploy_role_name.value
  policy = data.aws_iam_policy_document.gha_deploy_web.json
}
