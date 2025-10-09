resource "aws_iam_role" "ssm7_remediation_lambda_role" {
  name = "iamrobertyoung-security-hub-ssm7-remediation-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = local.tags
}

resource "aws_iam_role_policy" "ssm7_remediation_lambda_policy" {
  name = "iamrobertyoung-security-hub-ssm7-remediation-lambda-policy"
  role = aws_iam_role.ssm7_remediation_lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:*"
      },
      {
        Sid    = "AllowAssumeRemediationRole"
        Effect = "Allow"
        Action = [
          "sts:AssumeRole"
        ]
        Resource = "arn:aws:iam::*:role/iamrobertyoung-securityhub-remediation-cross-account-role"
        Condition = {
          StringEquals = {
            "aws:PrincipalOrgID" = data.aws_organizations_organization.org.id
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ssm7_remediation_lambda_basic" {
  role       = aws_iam_role.ssm7_remediation_lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}
