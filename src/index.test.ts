import { handleSecurityHubEvent } from "./index";
import { EventBridgeEvent, Context } from "aws-lambda";
import { AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  SSMClient,
  GetServiceSettingCommand,
  UpdateServiceSettingCommand,
} from "@aws-sdk/client-ssm";

// Mock AWS SDK modules
const mockSTSSend = jest.fn();
const mockSSMSend = jest.fn();

jest.mock("@aws-sdk/client-sts", () => ({
  STSClient: jest.fn(() => ({
    send: mockSTSSend,
  })),
  AssumeRoleCommand: jest.fn(),
}));

jest.mock("@aws-sdk/client-ssm", () => ({
  SSMClient: jest.fn(() => ({
    send: mockSSMSend,
  })),
  GetServiceSettingCommand: jest.fn(),
  UpdateServiceSettingCommand: jest.fn(),
}));

// Create a mock Security Hub finding for testing
const mockSSM7Finding = {
  SchemaVersion: "2018-10-08",
  Id: "arn:aws:securityhub:us-east-1:123456789012:finding/12345678-1234-1234-1234-123456789012",
  ProductArn: "arn:aws:securityhub:us-east-1::product/aws/securityhub",
  GeneratorId: "aws-foundational-security-standard/v/1.0.0/SSM.7",
  AwsAccountId: "123456789012",
  Types: ["Software and Configuration Checks/AWS Security Best Practices"],
  FirstObservedAt: "2023-10-09T10:00:00.000Z",
  LastObservedAt: "2023-10-09T12:00:00.000Z",
  CreatedAt: "2023-10-09T10:00:00.000Z",
  UpdatedAt: "2023-10-09T12:00:00.000Z",
  Severity: {
    Label: "MEDIUM",
  },
  Title: "SSM.7 SSM documents should not be public",
  Description:
    "This control checks whether AWS Systems Manager documents owned by the account are public.",
  Resources: [
    {
      Type: "AwsSsmDocument",
      Id: "arn:aws:ssm:us-east-1:123456789012:document/TestDocument",
      Partition: "aws",
      Region: "us-east-1",
    },
  ],
  Compliance: {
    SecurityControlId: "SSM.7",
    Status: "FAILED",
  },
  RecordState: "ACTIVE",
  WorkflowState: "NEW",
};

// Mock EventBridge event for testing - using simplified typing
const mockSecurityHubEvent: EventBridgeEvent<
  "Security Hub Findings - Imported",
  any
> = {
  id: "test-event-id",
  version: "0",
  "detail-type": "Security Hub Findings - Imported",
  source: "aws.securityhub",
  account: "123456789012",
  time: "2023-10-09T12:00:00Z",
  region: "us-east-1",
  resources: [],
  detail: {
    findings: [mockSSM7Finding],
  },
};

// Mock Lambda context
const mockContext: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: "SSM7RemediationFunction",
  functionVersion: "$LATEST",
  invokedFunctionArn:
    "arn:aws:lambda:us-east-1:123456789012:function:SSM7RemediationFunction",
  memoryLimitInMB: "512",
  awsRequestId: "test-request-id",
  logGroupName: "/aws/lambda/SSM7RemediationFunction",
  logStreamName: "2023/10/09/[$LATEST]test-stream",
  getRemainingTimeInMillis: () => 30000,
  done: () => {},
  fail: () => {},
  succeed: () => {},
};

/**
 * Jest test cases (run with npm test)
 */
describe("SSM.7 Remediation Lambda", () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();

    // Default successful STS mock
    mockSTSSend.mockResolvedValue({
      Credentials: {
        AccessKeyId: "mock-access-key",
        SecretAccessKey: "mock-secret-key",
        SessionToken: "mock-session-token",
      },
    });

    // Default SSM mock - setting already disabled
    mockSSMSend.mockResolvedValue({
      ServiceSetting: {
        SettingId: "/ssm/documents/console/public-sharing-permission",
        SettingValue: "Disable",
      },
    });
  });

  describe("Successful remediation scenarios", () => {
    test("should handle valid Security Hub SSM.7 finding with setting already disabled", async () => {
      const result = await handleSecurityHubEvent(
        mockSecurityHubEvent,
        mockContext
      );

      expect(result).toBeDefined();
      expect(result.remediatedFindings).toBe(1);
      expect(result.details).toHaveLength(1);
      expect(result.details[0]).toMatchObject({
        accountId: "123456789012",
        region: "us-east-1",
        status: "success",
        message: expect.stringContaining(
          "Successfully disabled SSM public sharing"
        ),
      });

      // Verify STS AssumeRole was called
      expect(mockSTSSend).toHaveBeenCalledWith(expect.any(AssumeRoleCommand));

      // Verify SSM GetServiceSetting was called
      expect(mockSSMSend).toHaveBeenCalledWith(
        expect.any(GetServiceSettingCommand)
      );

      // UpdateServiceSetting should NOT be called since setting is already disabled
      expect(mockSSMSend).toHaveBeenCalledTimes(1);
    });

    test("should handle valid Security Hub SSM.7 finding with setting needing update", async () => {
      // Mock SSM to return "Enable" first, then success for update
      mockSSMSend
        .mockResolvedValueOnce({
          ServiceSetting: {
            SettingId: "/ssm/documents/console/public-sharing-permission",
            SettingValue: "Enable",
          },
        })
        .mockResolvedValueOnce({}); // UpdateServiceSetting response

      const result = await handleSecurityHubEvent(
        mockSecurityHubEvent,
        mockContext
      );

      expect(result).toBeDefined();
      expect(result.remediatedFindings).toBe(1);
      expect(result.details).toHaveLength(1);
      expect(result.details[0].status).toBe("success");

      // Verify both GetServiceSetting and UpdateServiceSetting were called
      expect(mockSSMSend).toHaveBeenCalledTimes(2);
      expect(mockSSMSend).toHaveBeenNthCalledWith(
        1,
        expect.any(GetServiceSettingCommand)
      );
      expect(mockSSMSend).toHaveBeenNthCalledWith(
        2,
        expect.any(UpdateServiceSettingCommand)
      );
    });

    test("should handle multiple findings in same account-region", async () => {
      const multipleFindings = {
        ...mockSecurityHubEvent,
        detail: {
          findings: [
            mockSSM7Finding,
            {
              ...mockSSM7Finding,
              Id: "arn:aws:securityhub:us-east-1:123456789012:finding/another-finding",
            },
          ],
        },
      };

      const result = await handleSecurityHubEvent(
        multipleFindings,
        mockContext
      );

      expect(result.remediatedFindings).toBe(1); // Should be 1 because same account-region
      expect(result.details).toHaveLength(1);
      expect(result.details[0].findingId).toContain("another-finding");
    });

    test("should handle findings in different regions", async () => {
      const multiRegionFindings = {
        ...mockSecurityHubEvent,
        detail: {
          findings: [
            mockSSM7Finding,
            {
              ...mockSSM7Finding,
              Id: "arn:aws:securityhub:us-west-2:123456789012:finding/west-finding",
              Resources: [
                {
                  ...mockSSM7Finding.Resources[0],
                  Region: "us-west-2",
                },
              ],
            },
          ],
        },
      };

      const result = await handleSecurityHubEvent(
        multiRegionFindings,
        mockContext
      );

      expect(result.remediatedFindings).toBe(2); // Different regions should be counted separately
      expect(result.details).toHaveLength(2);

      const regions = result.details.map((d: any) => d.region);
      expect(regions).toContain("us-east-1");
      expect(regions).toContain("us-west-2");
    });

    test("should handle empty findings array", async () => {
      const emptyEvent = {
        ...mockSecurityHubEvent,
        detail: { findings: [] },
      };

      const result = await handleSecurityHubEvent(emptyEvent, mockContext);

      expect(result.remediatedFindings).toBe(0);
      expect(result.details).toHaveLength(0);

      // Should not call AWS services
      expect(mockSTSSend).not.toHaveBeenCalled();
      expect(mockSSMSend).not.toHaveBeenCalled();
    });

    test("should filter non-SSM.7 findings", async () => {
      const nonSSM7Event = {
        ...mockSecurityHubEvent,
        detail: {
          findings: [
            {
              ...mockSSM7Finding,
              Compliance: {
                SecurityControlId: "EC2.1",
                Status: "FAILED",
              },
            },
          ],
        },
      };

      const result = await handleSecurityHubEvent(nonSSM7Event, mockContext);

      expect(result.remediatedFindings).toBe(0);
      expect(result.details).toHaveLength(0);

      // Should not call AWS services for non-SSM.7 findings
      expect(mockSTSSend).not.toHaveBeenCalled();
      expect(mockSSMSend).not.toHaveBeenCalled();
    });

    test("should filter non-FAILED findings", async () => {
      const passedFindingEvent = {
        ...mockSecurityHubEvent,
        detail: {
          findings: [
            {
              ...mockSSM7Finding,
              Compliance: {
                SecurityControlId: "SSM.7",
                Status: "PASSED",
              },
            },
          ],
        },
      };

      const result = await handleSecurityHubEvent(
        passedFindingEvent,
        mockContext
      );

      expect(result.remediatedFindings).toBe(0);
      expect(result.details).toHaveLength(0);
    });

    test("should filter inactive findings", async () => {
      const inactiveFindingEvent = {
        ...mockSecurityHubEvent,
        detail: {
          findings: [
            {
              ...mockSSM7Finding,
              RecordState: "ARCHIVED",
            },
          ],
        },
      };

      const result = await handleSecurityHubEvent(
        inactiveFindingEvent,
        mockContext
      );

      expect(result.remediatedFindings).toBe(0);
      expect(result.details).toHaveLength(0);
    });
  });

  describe("Error handling scenarios", () => {
    test("should throw error for invalid event structure", async () => {
      const invalidEvent = {
        ...mockSecurityHubEvent,
        detail: {},
      } as any; // Cast to any since we're testing invalid structure

      await expect(
        handleSecurityHubEvent(invalidEvent, mockContext)
      ).rejects.toThrow("Invalid event structure - missing findings array");
    });

    test("should handle STS AssumeRole failure", async () => {
      mockSTSSend.mockRejectedValue(new Error("Access denied"));

      const result = await handleSecurityHubEvent(
        mockSecurityHubEvent,
        mockContext
      );

      expect(result.remediatedFindings).toBe(0);
      expect(result.details).toHaveLength(1);
      expect(result.details[0]).toMatchObject({
        status: "error",
        message: expect.stringContaining("Access denied"),
      });
    });

    test("should handle SSM GetServiceSetting failure", async () => {
      mockSSMSend.mockRejectedValue(new Error("SSM service unavailable"));

      const result = await handleSecurityHubEvent(
        mockSecurityHubEvent,
        mockContext
      );

      expect(result.remediatedFindings).toBe(0);
      expect(result.details).toHaveLength(1);
      expect(result.details[0]).toMatchObject({
        status: "error",
        message: expect.stringContaining("SSM service unavailable"),
      });
    });

    test("should handle SSM UpdateServiceSetting failure", async () => {
      // First call succeeds (GetServiceSetting), second fails (UpdateServiceSetting)
      mockSSMSend
        .mockResolvedValueOnce({
          ServiceSetting: {
            SettingId: "/ssm/documents/console/public-sharing-permission",
            SettingValue: "Enable",
          },
        })
        .mockRejectedValueOnce(new Error("Update failed"));

      const result = await handleSecurityHubEvent(
        mockSecurityHubEvent,
        mockContext
      );

      expect(result.remediatedFindings).toBe(0);
      expect(result.details).toHaveLength(1);
      expect(result.details[0]).toMatchObject({
        status: "error",
        message: expect.stringContaining("Update failed"),
      });
    });

    test("should handle missing event detail", async () => {
      const invalidEvent = {
        ...mockSecurityHubEvent,
        detail: undefined,
      } as any;

      await expect(
        handleSecurityHubEvent(invalidEvent, mockContext)
      ).rejects.toThrow("Invalid event structure - missing findings array");
    });
  });

  describe("Edge cases", () => {
    test("should handle finding without Resources", async () => {
      const findingWithoutResources = {
        ...mockSecurityHubEvent,
        detail: {
          findings: [
            {
              ...mockSSM7Finding,
              Resources: [],
            },
          ],
        },
      };

      const result = await handleSecurityHubEvent(
        findingWithoutResources,
        mockContext
      );

      expect(result.remediatedFindings).toBe(1);
      expect(result.details[0].region).toBe("us-east-1"); // Should fallback to extracted region from finding ID
    });

    test("should handle finding with malformed ARN", async () => {
      const findingWithBadArn = {
        ...mockSecurityHubEvent,
        detail: {
          findings: [
            {
              ...mockSSM7Finding,
              Id: "invalid-arn",
              Resources: [],
            },
          ],
        },
      };

      const result = await handleSecurityHubEvent(
        findingWithBadArn,
        mockContext
      );

      expect(result.remediatedFindings).toBe(1);
      expect(result.details[0].region).toBe("eu-west-1"); // Should fallback to default region
    });

    test("should handle partial remediation success", async () => {
      const multiAccountFindings = {
        ...mockSecurityHubEvent,
        detail: {
          findings: [
            mockSSM7Finding,
            {
              ...mockSSM7Finding,
              Id: "arn:aws:securityhub:us-east-1:999999999999:finding/another-account",
              AwsAccountId: "999999999999",
            },
          ],
        },
      };

      // First AssumeRole succeeds, second fails
      mockSTSSend
        .mockResolvedValueOnce({
          Credentials: {
            AccessKeyId: "mock-access-key",
            SecretAccessKey: "mock-secret-key",
            SessionToken: "mock-session-token",
          },
        })
        .mockRejectedValueOnce(new Error("Cross-account role not found"));

      const result = await handleSecurityHubEvent(
        multiAccountFindings,
        mockContext
      );

      expect(result.remediatedFindings).toBe(1); // One should succeed
      expect(result.details).toHaveLength(2);
      expect(result.details.some((d: any) => d.status === "success")).toBe(
        true
      );
      expect(result.details.some((d: any) => d.status === "error")).toBe(true);
    });
  });
});
