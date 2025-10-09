import {
  EventBridgeEvent,
  Context,
  Handler,
} from "aws-lambda";
import {
  SSMClient,
  UpdateServiceSettingCommand,
  GetServiceSettingCommand,
} from "@aws-sdk/client-ssm";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";

interface SSM7Finding {
  SchemaVersion: string;
  Id: string;
  ProductArn: string;
  GeneratorId: string;
  AwsAccountId: string;
  Types: string[];
  FirstObservedAt: string;
  LastObservedAt: string;
  CreatedAt: string;
  UpdatedAt: string;
  Severity: {
    Label: string;
  };
  Title: string;
  Description: string;
  Resources: Array<{
    Type: string;
    Id: string;
    Partition: string;
    Region: string;
  }>;
  Compliance: {
    SecurityControlId: string;
    Status: string;
  };
  RecordState: string;
  WorkflowState: string;
}

/**
 * Security Hub EventBridge detail structure
 */
interface SecurityHubEventDetail {
  findings: SSM7Finding[];
}

/**
 * Type alias for Security Hub EventBridge event
 */
type SecurityHubEvent = EventBridgeEvent<
  "Security Hub Findings - Imported",
  SecurityHubEventDetail
>;

/**
 * Remediation detail status
 */
type RemediationStatus = "success" | "error";

/**
 * Individual finding remediation detail
 */
interface FindingRemediationDetail {
  findingId: string;
  accountId: string;
  region: string;
  status: RemediationStatus;
  message: string;
}

/**
 * Lambda response interface
 */
interface RemediationResponse {
  remediatedFindings: number;
  details: FindingRemediationDetail[];
}

/**
 * Assume cross-account role for remediation
 */
async function assumeRemediationRole(
  accountId: string,
  region: string
): Promise<SSMClient> {
  const stsClient = new STSClient({ region });

  const roleArn = `arn:aws:iam::${accountId}:role/iamrobertyoung-securityhub-remediation-cross-account-role`;

  try {
    const assumeRoleResponse = await stsClient.send(
      new AssumeRoleCommand({
        RoleArn: roleArn,
        RoleSessionName: `ssm7-remediation-${Date.now()}`,
        DurationSeconds: 3600,
      })
    );

    if (!assumeRoleResponse.Credentials) {
      throw new Error("Failed to assume role - no credentials returned");
    }

    return new SSMClient({
      region,
      credentials: {
        accessKeyId: assumeRoleResponse.Credentials.AccessKeyId!,
        secretAccessKey: assumeRoleResponse.Credentials.SecretAccessKey!,
        sessionToken: assumeRoleResponse.Credentials.SessionToken!,
      },
    });
  } catch (error) {
    console.error(`Failed to assume role ${roleArn}:`, error);
    throw error;
  }
}

/**
 * Disable public sharing in SSM service settings
 */
async function disableSSMPublicSharing(
  ssmClient: SSMClient,
  region: string
): Promise<void> {
  const settingId = "/ssm/documents/console/public-sharing-permission";

  try {
    const currentSetting = await ssmClient.send(
      new GetServiceSettingCommand({
        SettingId: settingId,
      })
    );

    console.log(
      `Current SSM public sharing setting in ${region}: ${currentSetting.ServiceSetting?.SettingValue}`
    );

    // If already disabled, no need to update
    if (currentSetting.ServiceSetting?.SettingValue === "Disable") {
      console.log(`SSM public sharing already disabled in ${region}`);
      return;
    }

    // Disable public sharing
    await ssmClient.send(
      new UpdateServiceSettingCommand({
        SettingId: settingId,
        SettingValue: "Disable",
      })
    );

    console.log(`Successfully disabled SSM public sharing in region ${region}`);
  } catch (error) {
    console.error(
      `Failed to disable SSM public sharing in region ${region}:`,
      error
    );
    throw error;
  }
}

/**
 * Main Lambda handler function
 */
const handleSecurityHubEvent = async (
  event: SecurityHubEvent,
  context: Context
): Promise<RemediationResponse> => {
  console.log("SSM.7 Remediation Lambda triggered");
  console.log("Event:", JSON.stringify(event, null, 2));
  console.log("Context:", JSON.stringify(context, null, 2));

  // Initialize response
  const response: RemediationResponse = {
    remediatedFindings: 0,
    details: [],
  };
  const errors: string[] = [];

  try {
    // Validate event structure
    if (!event.detail?.findings || !Array.isArray(event.detail.findings)) {
      throw new Error("Invalid event structure - missing findings array");
    }

    // Filter for SSM.7 findings that are non-compliant
    const ssm7Findings = event.detail.findings.filter(
      (finding: SSM7Finding) =>
        finding.Compliance.SecurityControlId === "SSM.7" &&
        finding.Compliance?.Status === "FAILED" &&
        finding.RecordState === "ACTIVE"
    );

    console.log(
      `Found ${ssm7Findings.length} SSM.7 non-compliant findings to remediate`
    );

    const remediationTargets = new Map<
      string,
      { accountId: string; region: string; findings: SSM7Finding[] }
    >();

    for (const finding of ssm7Findings) {
      let region = finding.Resources?.[0]?.Region;

      if (!region) {
        const arnMatch = finding.Id.match(/arn:aws:securityhub:([^:]+):/);
        region = arnMatch ? arnMatch[1] : "eu-west-1";
      }

      const key = `${finding.AwsAccountId}-${region}`;

      if (!remediationTargets.has(key)) {
        remediationTargets.set(key, {
          accountId: finding.AwsAccountId,
          region: region,
          findings: [],
        });
      }

      remediationTargets.get(key)!.findings.push(finding);
    }

    console.log(
      `Found ${remediationTargets.size} unique account-region combinations to remediate`
    );

    // Process each unique account-region combination
    for (const [key, target] of remediationTargets) {
      const findingDetail: FindingRemediationDetail = {
        findingId: target.findings.map((f) => f.Id).join(", "),
        accountId: target.accountId,
        region: target.region,
        status: "error",
        message: "",
      };

      try {
        console.log(
          `Processing ${target.findings.length} finding(s) in account ${target.accountId}, region ${target.region}`
        );

        // Assume role in target account
        const ssmClient = await assumeRemediationRole(
          target.accountId,
          target.region
        );

        // Disable SSM public sharing for this region
        await disableSSMPublicSharing(ssmClient, target.region);

        findingDetail.status = "success";
        findingDetail.message = `Successfully disabled SSM public sharing in region ${target.region}`;

        // Increment the count of successfully remediated findings
        response.remediatedFindings += 1;

        console.log(
          `Successfully remediated ${target.findings.length} finding(s) for ${key}`
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        findingDetail.message = `Remediation failed: ${errorMessage}`;

        console.error(`Failed to remediate findings for ${key}:`, error);
      }

      response.details.push(findingDetail);
    }

    // Check for errors and throw if all failed or handle partial failures
    if (errors.length > 0 && response.remediatedFindings === 0) {
      // All remediation attempts failed
      throw new Error(`All remediation attempts failed: ${errors.join("; ")}`);
    } else if (errors.length > 0) {
      // Some succeeded, some failed - log warnings but continue
      console.warn(`Partial remediation success. Errors: ${errors.join("; ")}`);
    }

    console.log(
      `Remediation complete. Success: ${response.remediatedFindings}, Errors: ${errors.length}`
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error("Lambda execution failed:", error);
    throw error;
  }

  return response;
};

/**
 * Export the main handler function for testing
 */
export { handleSecurityHubEvent };

/**
 * Lambda handler export - compatible with AWS Lambda runtime
 */
export const handler = handleSecurityHubEvent;
