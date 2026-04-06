import { ConflictException } from "@nestjs/common";
import { PaymentChannelsService } from "../src/modules/payment-channels/payment-channels.service";

describe("PaymentChannelsService", () => {
  it("returns idempotent response for duplicate callback with same payload hash", async () => {
    const prisma = {
      paymentChannelRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: "req1",
          payloadHash: "hash-1",
          verificationStatus: "VERIFIED",
          transactionId: "tx1"
        })
      }
    } as any;
    const signatures = {
      verify: jest.fn().mockReturnValue({ valid: true, payloadHash: "hash-1" })
    } as any;
    const service = new PaymentChannelsService(
      prisma,
      signatures,
      { postApprovedChargeFromChannel: jest.fn() } as any,
      { write: jest.fn() } as any
    );

    const result = (await service.processSignedCharge({
      channel: "prepaid_balance",
      payload: { bundleCount: 1 },
      systemIdentity: "sys",
      signature: "sig",
      timestamp: `${Date.now()}`,
      nonce: "n1",
      idempotencyKey: "k1"
    } as any)) as { idempotent: boolean; transactionId: string | null };

    expect(result.idempotent).toBe(true);
    expect(result.transactionId).toBe("tx1");
  });

  it("rejects duplicate idempotency key with mutated payload", async () => {
    const create = jest.fn().mockResolvedValue({ id: "req2" });
    const prisma = {
      paymentChannelRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: "req1",
          payloadHash: "old-hash",
          verificationStatus: "VERIFIED",
          transactionId: "tx1"
        }),
        create
      }
    } as any;
    const signatures = {
      verify: jest.fn().mockReturnValue({ valid: true, payloadHash: "new-hash" }),
      parseTimestamp: jest.fn().mockReturnValue(new Date())
    } as any;
    const service = new PaymentChannelsService(
      prisma,
      signatures,
      { postApprovedChargeFromChannel: jest.fn() } as any,
      { write: jest.fn() } as any
    );

    await expect(
      service.processSignedCharge({
        channel: "prepaid_balance",
        payload: { bundleCount: 2 },
        systemIdentity: "sys",
        signature: "sig",
        timestamp: `${Date.now()}`,
        nonce: "n1",
        idempotencyKey: "k1"
      } as any)
    ).rejects.toBeInstanceOf(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });
});
