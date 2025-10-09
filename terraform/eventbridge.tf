
# EventBridge rule for Security Hub SSM.7 findings
resource "aws_cloudwatch_event_rule" "ssm7_security_hub_finding" {
  name        = "iamrobertyoung-security-hub-ssm7-finding-rule"
  description = "Trigger SSM.7 remediation when Security Hub finds non-compliant SSM documents"

  event_pattern = jsonencode({
    source      = ["aws.securityhub"]
    detail-type = ["Security Hub Findings - Imported"]
    detail = {
      findings = {
        Compliance = {
          Status = ["FAILED"]
        }
        RecordState   = ["ACTIVE"]
        WorkflowState = ["NEW", "NOTIFIED"]
      }
    }
  })

  tags = local.tags
}

resource "aws_cloudwatch_event_target" "ssm7_remediation_target" {
  rule      = aws_cloudwatch_event_rule.ssm7_security_hub_finding.name
  target_id = "iamrobertyoung-security-hub-ssm7-remediation-target"
  arn       = aws_lambda_function.ssm7_remediation.arn
}

resource "aws_lambda_permission" "allow_eventbridge_ssm7" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ssm7_remediation.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.ssm7_security_hub_finding.arn
}
