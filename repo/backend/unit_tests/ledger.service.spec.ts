import { LedgerService } from "../src/modules/ledger/ledger.service";

describe("LedgerService", () => {
  describe("appendEntry", () => {
    it("creates first entry with net equal to amount when no prior entries exist", async () => {
      const createMock = jest.fn().mockResolvedValue({ id: "entry-1", netAmountCents: 2500 });
      const prisma = {
        fundLedger: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: createMock
        }
      } as any;
      const service = new LedgerService(prisma);

      await service.appendEntry({
        transactionId: "tx-1",
        entryType: "CHARGE",
        amountCents: 2500,
        createdByUserId: "u1"
      });

      expect(createMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          transactionId: "tx-1",
          entryType: "CHARGE",
          amountCents: 2500,
          netAmountCents: 2500
        })
      });
    });

    it("accumulates net amount from previous entry when prior entries exist", async () => {
      const createMock = jest.fn().mockResolvedValue({ id: "entry-2", netAmountCents: 3500 });
      const prisma = {
        fundLedger: {
          findFirst: jest.fn().mockResolvedValue({ netAmountCents: 2500 }),
          create: createMock
        }
      } as any;
      const service = new LedgerService(prisma);

      await service.appendEntry({
        transactionId: "tx-1",
        entryType: "CHARGE",
        amountCents: 1000
      });

      expect(createMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amountCents: 1000,
          netAmountCents: 3500
        })
      });
    });

    it("reduces net amount for negative refund entries", async () => {
      const createMock = jest.fn().mockResolvedValue({ id: "entry-3", netAmountCents: 1500 });
      const prisma = {
        fundLedger: {
          findFirst: jest.fn().mockResolvedValue({ netAmountCents: 2500 }),
          create: createMock
        }
      } as any;
      const service = new LedgerService(prisma);

      await service.appendEntry({
        transactionId: "tx-1",
        entryType: "REFUND",
        amountCents: -1000
      });

      expect(createMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entryType: "REFUND",
          amountCents: -1000,
          netAmountCents: 1500
        })
      });
    });

    it("stores optional metadata and createdByUserId", async () => {
      const createMock = jest.fn().mockResolvedValue({ id: "entry-4", netAmountCents: 500 });
      const prisma = {
        fundLedger: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: createMock
        }
      } as any;
      const service = new LedgerService(prisma);

      await service.appendEntry({
        transactionId: "tx-2",
        entryType: "FREEZE",
        amountCents: 500,
        createdByUserId: "admin-user",
        metadata: { reason: "investigation" }
      });

      expect(createMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          createdByUserId: "admin-user",
          metadata: { reason: "investigation" }
        })
      });
    });

    it("orders findFirst by createdAt desc to get latest net balance", async () => {
      const findFirstMock = jest.fn().mockResolvedValue(null);
      const prisma = {
        fundLedger: {
          findFirst: findFirstMock,
          create: jest.fn().mockResolvedValue({ id: "e1", netAmountCents: 0 })
        }
      } as any;
      const service = new LedgerService(prisma);

      await service.appendEntry({ transactionId: "tx-3", entryType: "CHARGE", amountCents: 100 });

      expect(findFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { transactionId: "tx-3" },
          orderBy: { createdAt: "desc" }
        })
      );
    });
  });

  describe("getRefundedCents", () => {
    it("returns zero when no refund cases exist", async () => {
      const prisma = {
        refundCase: { findMany: jest.fn().mockResolvedValue([]) }
      } as any;
      const service = new LedgerService(prisma);

      const result = await service.getRefundedCents("tx-1");
      expect(result).toBe(0);
    });

    it("sums all refund case amountCents for the given transaction", async () => {
      const prisma = {
        refundCase: {
          findMany: jest.fn().mockResolvedValue([
            { amountCents: 500 },
            { amountCents: 300 },
            { amountCents: 200 }
          ])
        }
      } as any;
      const service = new LedgerService(prisma);

      const result = await service.getRefundedCents("tx-1");
      expect(result).toBe(1000);
    });

    it("queries refund cases filtered by transactionId", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const service = new LedgerService({ refundCase: { findMany } } as any);

      await service.getRefundedCents("tx-specific");
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { transactionId: "tx-specific" } })
      );
    });

    it("returns correct sum for single refund case", async () => {
      const prisma = {
        refundCase: { findMany: jest.fn().mockResolvedValue([{ amountCents: 750 }]) }
      } as any;
      const service = new LedgerService(prisma);

      const result = await service.getRefundedCents("tx-single");
      expect(result).toBe(750);
    });
  });
});
