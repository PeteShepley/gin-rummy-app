# The WebSocket relay: an API Gateway v2 WebSocket API in front of the
# gin-rummy-relay Lambda, which sequences and fans out room messages. Terraform
# owns the Lambda's shell; CI (deploy-relay.yml) owns its code — the same split
# used for the HTTP API (see lambda.tf), reusing that file's placeholder zip.

# --- WebSocket API ---------------------------------------------------------

resource "aws_apigatewayv2_api" "gin_rummy_ws" {
  name          = "gin-rummy-ws"
  protocol_type = "WEBSOCKET"
  # The relay dispatches every message kind inside the Lambda, so a single
  # $default route is enough; API Gateway only needs a stable selector.
  route_selection_expression = "$request.body.kind"
}

resource "aws_apigatewayv2_integration" "ws_relay" {
  api_id           = aws_apigatewayv2_api.gin_rummy_ws.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.relay.invoke_arn
  # WebSocket integrations use the 1.0 event shape; payload_format_version is
  # an HTTP-API concept and must not be set here.
}

resource "aws_apigatewayv2_route" "ws_connect" {
  api_id    = aws_apigatewayv2_api.gin_rummy_ws.id
  route_key = "$connect"
  target    = "integrations/${aws_apigatewayv2_integration.ws_relay.id}"
}

resource "aws_apigatewayv2_route" "ws_disconnect" {
  api_id    = aws_apigatewayv2_api.gin_rummy_ws.id
  route_key = "$disconnect"
  target    = "integrations/${aws_apigatewayv2_integration.ws_relay.id}"
}

resource "aws_apigatewayv2_route" "ws_default" {
  api_id    = aws_apigatewayv2_api.gin_rummy_ws.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.ws_relay.id}"
}

# WebSocket APIs have no auto-created $default stage; a named stage gives the
# wss://.../<stage> invoke URL (the custom domain in ws-domain.tf maps to it).
resource "aws_apigatewayv2_stage" "ws_default" {
  api_id      = aws_apigatewayv2_api.gin_rummy_ws.id
  name        = "prod"
  auto_deploy = true
}

resource "aws_lambda_permission" "ws_apigw" {
  statement_id  = "AllowWebSocketInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.relay.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.gin_rummy_ws.execution_arn}/*/*"
}

# --- Relay Lambda ----------------------------------------------------------

resource "aws_iam_role" "relay_exec" {
  name = "gin-rummy-relay-lambda-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "relay_basic_execution" {
  role       = aws_iam_role.relay_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# The relay owns the rooms table and posts messages back over the socket.
data "aws_iam_policy_document" "relay" {
  statement {
    sid    = "Rooms"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
    ]
    resources = [aws_dynamodb_table.rooms.arn]
  }

  statement {
    sid       = "ManageConnections"
    effect    = "Allow"
    actions   = ["execute-api:ManageConnections"]
    resources = ["${aws_apigatewayv2_api.gin_rummy_ws.execution_arn}/*"]
  }
}

resource "aws_iam_role_policy" "relay" {
  name   = "gin-rummy-relay"
  role   = aws_iam_role.relay_exec.id
  policy = data.aws_iam_policy_document.relay.json
}

resource "aws_cloudwatch_log_group" "relay" {
  name              = "/aws/lambda/gin-rummy-relay"
  retention_in_days = 14
}

resource "aws_lambda_function" "relay" {
  function_name = "gin-rummy-relay"
  role          = aws_iam_role.relay_exec.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  timeout       = 10
  memory_size   = 256

  # Reuses the placeholder zip from lambda.tf; real code arrives via CI.
  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  environment {
    variables = {
      ROOMS_TABLE = aws_dynamodb_table.rooms.name
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.relay_basic_execution,
    aws_cloudwatch_log_group.relay,
  ]

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}
