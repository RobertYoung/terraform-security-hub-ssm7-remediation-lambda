
data "archive_file" "ssm7_remediation_lambda_zip" {
  type        = "zip"
  output_path = "${path.module}/ssm7-remediation.zip"
  source_dir  = "${path.module}/../dist"
}

resource "aws_lambda_function" "ssm7_remediation" {
  filename      = data.archive_file.ssm7_remediation_lambda_zip.output_path
  function_name = "iamrobertyoung-security-hub-ssm7-remediation"
  role          = aws_iam_role.ssm7_remediation_lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  timeout       = 300
  memory_size   = 512

  source_code_hash = data.archive_file.ssm7_remediation_lambda_zip.output_base64sha256

  environment {
    variables = {
      NODE_ENV  = "production"
      LOG_LEVEL = "info"
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.ssm7_remediation_lambda_basic,
    aws_cloudwatch_log_group.ssm7_remediation_lambda_logs
  ]

  tags = local.tags
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "ssm7_remediation_lambda_logs" {
  name              = "/aws/lambda/iamrobertyoung-security-hub-ssm7-remediation"
  retention_in_days = 30

  tags = local.tags
}
