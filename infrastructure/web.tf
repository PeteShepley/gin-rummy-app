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
