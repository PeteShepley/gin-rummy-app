terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  backend "s3" {
    bucket         = "peteshepley-ops-tofu-state"
    key            = "apps/gin-rummy-app/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "peteshepley-ops-tofu-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
}

# The consolidated per-repo GitHub OIDC deploy role (gha-deploy-gin-rummy-app),
# created in operations/infra/002-github-projects. iam.tf and web.tf each attach
# their own policy to it. The legacy per-purpose roles (github_deploy_api in
# iam.tf, and the one the module still creates in web.tf) stay in place and in
# use alongside it until AWS_ROLE_ARN secrets are cut over and those roles are
# decommissioned.
data "aws_ssm_parameter" "deploy_role_name" {
  name = "/github-deploy/gin-rummy-app/role-name"
}
