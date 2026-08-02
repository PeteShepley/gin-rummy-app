# Static hosting for clients/web (S3 + CloudFront), provisioned via the shared
# module. Referenced by local relative path since this repo and
# terraform-aws-static-app are checked out as sibling directories on this
# developer's machine. Its deploy policy attaches to the consolidated role
# (data.aws_ssm_parameter.deploy_role_name in main.tf) rather than the module
# creating its own — iam.tf attaches this repo's other policy (Lambda deploy)
# to the same role.
module "web" {
  source = "github.com/PeteShepley/terraform-aws-static-app"

  app_name             = "gin-rummy-app"
  site_bucket_name     = var.site_bucket_name
  domain_name          = var.domain_name
  root_domain_name     = var.root_domain_name
  distribution_comment = "gin-rummy-app (${var.domain_name})"
  github_repo          = var.github_repo

  create_deploy_role = false
  deploy_role_name   = data.aws_ssm_parameter.deploy_role_name.value
}
