# Custom domain: gin-rummy.ws.peteshepley.com. Mirrors api-domain.tf. The
# wildcard cert for *.ws.peteshepley.com is managed centrally at the account
# level and looked up here by domain name rather than created — the same
# convention the HTTP API's custom domain uses.
#
# NOTE: this assumes a *.ws.peteshepley.com ISSUED cert exists. If it does not
# yet, provision it centrally before applying this file (or point
# var.ws_root_domain_name at an existing wildcard that covers the subdomain).
data "aws_acm_certificate" "ws_wildcard" {
  domain      = var.ws_root_domain_name
  statuses    = ["ISSUED"]
  types       = ["AMAZON_ISSUED"]
  most_recent = true
}

resource "aws_apigatewayv2_domain_name" "gin_rummy_ws" {
  domain_name = var.ws_domain_name

  domain_name_configuration {
    certificate_arn = data.aws_acm_certificate.ws_wildcard.arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "gin_rummy_ws" {
  api_id      = aws_apigatewayv2_api.gin_rummy_ws.id
  domain_name = aws_apigatewayv2_domain_name.gin_rummy_ws.id
  stage       = aws_apigatewayv2_stage.ws_default.id
}
