# SSM.7 Remediation Lambda

This Lambda function automatically remediates AWS Security Hub findings for the SSM.7 control by disabling the SSM public sharing service setting.

## Overview

**SSM.7** - SSM documents should not be public

This control checks whether the AWS Systems Manager (SSM) service setting for public sharing is enabled. When this setting is enabled, it allows SSM documents to be shared publicly. The remediation disables this service setting to prevent any documents from being shared publicly.

## How It Works

1. **EventBridge Trigger**: The Lambda is triggered by Security Hub findings via EventBridge when SSM.7 violations are detected
2. **Cross-Account Access**: Uses AWS STS to assume the cross-account role in the target account
3. **Remediation**: Calls `UpdateServiceSetting` to disable the SSM public sharing service setting (`/ssm/documents/console/public-sharing-permission`)
4. **Efficiency**: Groups findings by account and region to avoid duplicate remediation calls
5. **Monitoring**: Logs all actions and provides detailed response information

## Architecture

```
Security Hub → EventBridge → Lambda → STS AssumeRole → SSM UpdateServiceSetting
```

## Prerequisites

- The `SSMCrossAccountUpdateServiceSettingRole` must be deployed to all target accounts via CloudFormation StackSet
- Security Hub must be enabled and the AWS Foundational Security Standard must be active
- Appropriate IAM permissions for the Lambda execution role

## Event Structure

See [example.json](./example.json)

## Response Format

The Lambda returns a detailed response indicating the success or failure of each remediation attempt:

```json
{
  "statusCode": 200,
  "body": {
    "remediatedFindings": 1,
    "errors": [],
    "details": [
      {
        "findingId": "arn:aws:securityhub:...",
        "accountId": "123456789012",
        "documentName": "MyDocument",
        "status": "success",
        "message": "Successfully disabled public sharing for document MyDocument"
      }
    ]
  }
}
```

## Status Codes

- **200**: All remediations succeeded
- **207**: Partial success (some remediations failed)
- **500**: All remediations failed or Lambda execution error

## Development

### Prerequisites

- Node.js 18.x or later
- npm or yarn
- TypeScript

### Setup

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run linting
npm run lint

# Create deployment package
npm run package
```

### Local Testing

The Lambda can be tested locally by creating test events that match the Security Hub EventBridge structure.

## Deployment

The Lambda is deployed via Terraform in the `security-admin` account. The deployment includes:

- Lambda function with appropriate IAM role
- EventBridge rule to capture Security Hub SSM.7 findings
- CloudWatch Log Group for monitoring
- CloudWatch Dashboard for metrics visualization

## Monitoring

### CloudWatch Metrics

The Lambda function is monitored via CloudWatch with the following key metrics:

- **Invocations**: Number of times the Lambda is triggered
- **Errors**: Number of execution errors
- **Duration**: Execution time
- **Throttles**: Number of throttled executions

### CloudWatch Logs

All Lambda execution details are logged to `/aws/lambda/SSM7RemediationFunction` with structured logging for easy analysis.

### Dashboard

A CloudWatch dashboard named `SSM7-Remediation-Dashboard` provides a consolidated view of:

- Lambda metrics over time
- Recent execution logs
- Error trends

## Error Handling

The Lambda includes comprehensive error handling:

- **Role Assumption Failures**: Logged with specific error details
- **SSM API Failures**: Captured and reported per finding
- **Invalid Event Structure**: Validated and rejected with clear messages
- **Partial Failures**: Continues processing other findings even if some fail

## Security Considerations

- The Lambda only assumes roles within the same AWS Organization
- Cross-account role assumption is time-limited (1 hour)
- All actions are logged for audit purposes
- Follows least-privilege access principles

## Troubleshooting

### Common Issues

1. **Role Assumption Failures**

   - Verify the `SSMCrossAccountUpdateServiceSettingRole` exists in the target account
   - Check Organization membership
   - Validate IAM permissions

2. **Document Not Found**

   - Ensure the document exists in the target account
   - Check the document name extraction logic

3. **Permission Denied**
   - Verify the cross-account role has the necessary SSM permissions
   - Check for resource-based policies that might block access

### Debug Mode

Set the `LOG_LEVEL` environment variable to `debug` for additional logging output.

## Contributing

When making changes to the Lambda:

1. Update TypeScript source code in `src/`
2. Add appropriate unit tests
3. Update this README if functionality changes
4. Run `npm run build` and `npm run lint` before deployment
5. Test with realistic Security Hub events
