# --- Web (clients/web, via module.web) ---

output "site_bucket_name" {
  description = "Name of the web client's S3 bucket — set as SITE_BUCKET_NAME in the repo's Actions variables"
  value       = module.web.site_bucket_name
}

output "site_bucket_arn" {
  description = "ARN of the web client's S3 bucket"
  value       = module.web.site_bucket_arn
}

output "cloudfront_distribution_id" {
  description = "ID of the web client's CloudFront distribution — set as CLOUDFRONT_DISTRIBUTION_ID in the repo's Actions variables"
  value       = module.web.cloudfront_distribution_id
}

output "cloudfront_distribution_arn" {
  description = "ARN of the web client's CloudFront distribution"
  value       = module.web.cloudfront_distribution_arn
}

output "cloudfront_domain_name" {
  description = "Default CloudFront domain — use this to test before DNS is wired up"
  value       = module.web.cloudfront_domain_name
}

output "cloudfront_hosted_zone_id" {
  description = "CloudFront's hosted zone ID — needed for a Route53 alias record"
  value       = module.web.cloudfront_hosted_zone_id
}

output "web_github_deploy_role_arn" {
  description = "ARN for the consolidated GitHub Actions deploy role — set as AWS_ROLE_ARN_WEB in the repo's Actions secrets (same role/ARN as api_github_deploy_role_arn below)"
  sensitive   = true
  value       = data.aws_ssm_parameter.deploy_role_arn.value
}

# --- API (services/api) ---

output "lambda_function_name" {
  description = "Name of the gin-rummy-api Lambda function — set as LAMBDA_FUNCTION_NAME in the repo's Actions variables"
  value       = aws_lambda_function.api.function_name
}

output "lambda_function_arn" {
  description = "ARN of the gin-rummy-api Lambda function"
  value       = aws_lambda_function.api.arn
}

output "api_endpoint" {
  description = "Base invoke URL for the HTTP API (execute-api.amazonaws.com — still live alongside the custom domain below)"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "api_custom_domain_url" {
  description = "Custom domain URL for the API"
  value       = "https://${aws_apigatewayv2_domain_name.gin_rummy_api.domain_name}"
}

output "api_custom_domain_target" {
  description = "Regional target domain name for the API's custom domain — needed for a Route53 alias record"
  value       = aws_apigatewayv2_domain_name.gin_rummy_api.domain_name_configuration[0].target_domain_name
}

output "api_custom_domain_hosted_zone_id" {
  description = "Hosted zone ID for api_custom_domain_target — needed for a Route53 alias record"
  value       = aws_apigatewayv2_domain_name.gin_rummy_api.domain_name_configuration[0].hosted_zone_id
}

output "api_github_deploy_role_arn" {
  description = "ARN for the consolidated GitHub Actions deploy role — set as AWS_ROLE_ARN_API in the repo's Actions secrets (same role/ARN as web_github_deploy_role_arn above)"
  sensitive   = true
  value       = data.aws_ssm_parameter.deploy_role_arn.value
}

# --- WebSocket relay (services/relay) ---

output "relay_function_name" {
  description = "Name of the gin-rummy-relay Lambda function — set as RELAY_FUNCTION_NAME in the repo's Actions variables"
  value       = aws_lambda_function.relay.function_name
}

output "relay_function_arn" {
  description = "ARN of the gin-rummy-relay Lambda function"
  value       = aws_lambda_function.relay.arn
}

output "ws_endpoint" {
  description = "Raw WebSocket invoke URL (execute-api) — still live alongside the custom domain below"
  value       = aws_apigatewayv2_stage.ws_default.invoke_url
}

output "ws_custom_domain_url" {
  description = "Custom-domain WebSocket URL — set as VITE_WS_URL in the repo's Actions variables"
  value       = "wss://${aws_apigatewayv2_domain_name.gin_rummy_ws.domain_name}"
}

output "ws_custom_domain_target" {
  description = "Regional target domain name for the WS custom domain — needed for a Route53 alias record"
  value       = aws_apigatewayv2_domain_name.gin_rummy_ws.domain_name_configuration[0].target_domain_name
}

output "ws_custom_domain_hosted_zone_id" {
  description = "Hosted zone ID for ws_custom_domain_target — needed for a Route53 alias record"
  value       = aws_apigatewayv2_domain_name.gin_rummy_ws.domain_name_configuration[0].hosted_zone_id
}
