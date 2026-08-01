# gin-rummy-app infrastructure

Terraform (OpenTofu-compatible) stack that owns all real AWS infrastructure
for this monorepo:

- **API** (`services/api`): a Lambda function, its IAM role, and an HTTP
  API (API Gateway v2) with a custom domain.
- **Web** (`clients/web`): S3 + CloudFront static hosting with a custom
  domain, provisioned via the shared
  [`terraform-aws-static-app`](../../terraform-aws-static-app) module.

AWS SAM (`services/api/template.yaml`) is a **local-only** development aid
(`sam local start-api`) — it is never deployed. Terraform owns the real
Lambda and API Gateway, and CI deploys code directly (see
[`.github/workflows`](../.github/workflows)) without ever running
`tofu apply`.

## What this assumes

- A wildcard ACM certificate for `peteshepley.com` (web) and one for
  `api.peteshepley.com` (API) already exist — both are looked up via data
  source, never created here.
- An account-level GitHub OIDC provider
  (`https://token.actions.githubusercontent.com`) already exists.
- The sibling repo `terraform-aws-static-app` is checked out one directory
  above this repo's own root (`module.web`'s `source` is the relative path
  `../../terraform-aws-static-app`). This only matters for `tofu
  plan`/`apply`, which is a manual, local-machine step — never run in CI.

## Usage

```bash
cd infrastructure
tofu init
tofu plan
tofu apply
```

State is stored remotely in the shared backend: S3 bucket
`peteshepley-ops-tofu-state`, key `apps/gin-rummy-app/terraform.tfstate`,
DynamoDB lock table `peteshepley-ops-tofu-locks`. Both the API and web
stacks share this single state file — a `tofu apply` touching one
re-evaluates the other, but both stacks are small enough that this isn't a
practical concern.

The first `tofu apply` deploys the Lambda with placeholder code (see
`lambda-placeholder/`); real code is deployed independently by CI via
`aws lambda update-function-code`, and `lifecycle.ignore_changes` on
`aws_lambda_function.api` keeps a later `tofu apply` from reverting it.

## Outputs → GitHub Actions secrets/variables

| Terraform output | GitHub Actions | Used by |
| --- | --- | --- |
| `api_github_deploy_role_arn` | Secret `AWS_ROLE_ARN_API` | `deploy-api.yml` |
| `lambda_function_name` | Variable `LAMBDA_FUNCTION_NAME` | `deploy-api.yml` |
| `web_github_deploy_role_arn` | Secret `AWS_ROLE_ARN_WEB` | `deploy-web.yml` |
| `site_bucket_name` | Variable `SITE_BUCKET_NAME` | `deploy-web.yml` |
| `cloudfront_distribution_id` | Variable `CLOUDFRONT_DISTRIBUTION_ID` | `deploy-web.yml` |

The remaining outputs (`api_endpoint`, `api_custom_domain_url`,
`api_custom_domain_target`, `api_custom_domain_hosted_zone_id`,
`cloudfront_domain_name`, `cloudfront_hosted_zone_id`, ARNs) aren't consumed
by CI — they're useful for manual verification or wiring up DNS records.

## Files

- `main.tf` — Terraform/backend/provider configuration.
- `variables.tf` — input variables (region, domains, GitHub repo, CORS).
- `lambda.tf` / `lambda-placeholder/` — the API's Lambda function, IAM role, and placeholder code.
- `apigateway.tf` — the API's HTTP API, route, integration, and stage.
- `api-domain.tf` — the API's custom domain.
- `iam.tf` — the API's GitHub OIDC deploy role.
- `web.tf` — the web client's static hosting, via `module.web`.
- `outputs.tf` — outputs consumed by CI and for manual verification.
