# Terraform owns this function's shell; the gin-rummy-app repo's
# deploy-api.yml workflow owns its code via `aws lambda update-function-code`.
# The placeholder zip below only exists so this stack can be applied before
# any real code has been deployed — ignore_changes keeps a later
# `tofu apply` from reverting a real deploy, the same split used for the
# static site (Terraform owns the S3 bucket; CI owns its contents).

data "archive_file" "placeholder" {
  type        = "zip"
  source_dir  = "${path.module}/lambda-placeholder"
  output_path = "${path.module}/.placeholder.zip"
}

resource "aws_iam_role" "lambda_exec" {
  name = "gin-rummy-api-lambda-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/gin-rummy-api"
  retention_in_days = 14
}

resource "aws_lambda_function" "api" {
  function_name = "gin-rummy-api"
  role          = aws_iam_role.lambda_exec.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  timeout       = 10
  memory_size   = 256

  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic_execution,
    aws_cloudwatch_log_group.api,
  ]

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}
