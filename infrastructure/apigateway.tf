resource "aws_apigatewayv2_api" "gin_rummy_api" {
  name          = "gin-rummy-api"
  protocol_type = "HTTP"

  # Native HTTP API CORS support — API Gateway answers preflight OPTIONS
  # requests itself, so browser-based clients can call this cross-origin.
  cors_configuration {
    allow_origins = var.cors_allowed_origins
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 300
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.gin_rummy_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

# No auth requirement yet, so a single catch-all ANY route is enough — no
# per-verb workaround is needed since there's no authorizer for OPTIONS to
# accidentally collide with.
resource "aws_apigatewayv2_route" "proxy" {
  api_id    = aws_apigatewayv2_api.gin_rummy_api.id
  route_key = "ANY /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.gin_rummy_api.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.gin_rummy_api.execution_arn}/*/*"
}
