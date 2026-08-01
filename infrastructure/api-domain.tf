# Custom domain: gin-rummy.api.peteshepley.com. Wildcard cert for
# *.api.peteshepley.com is managed centrally at the account level — looked
# up here by domain name rather than created, matching the convention
# documented in terraform-aws-static-app's README.
data "aws_acm_certificate" "api_wildcard" {
  domain      = var.api_root_domain_name
  statuses    = ["ISSUED"]
  types       = ["AMAZON_ISSUED"]
  most_recent = true
}

resource "aws_apigatewayv2_domain_name" "gin_rummy_api" {
  domain_name = var.api_domain_name

  domain_name_configuration {
    certificate_arn = data.aws_acm_certificate.api_wildcard.arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "gin_rummy_api" {
  api_id      = aws_apigatewayv2_api.gin_rummy_api.id
  domain_name = aws_apigatewayv2_domain_name.gin_rummy_api.id
  stage       = aws_apigatewayv2_stage.default.id
}
