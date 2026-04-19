import { AuditLogsService } from "../src/modules/audit-logs/audit-logs.service";

describe("AuditLogsService", () => {
  describe("write", () => {
    it("creates an immutable audit log entry with all provided fields", async () => {
      const createMock = jest.fn().mockResolvedValue({ id: "log-1" });
      const cacheMock = { invalidatePatterns: jest.fn().mockResolvedValue(undefined) };
      const service = new AuditLogsService(
        { immutableAuditLog: { create: createMock } } as any,
        cacheMock as any
      );

      await service.write({
        userId: "u1",
        actionType: "MERGE_APPLIED",
        entityType: "story",
        entityId: "s1",
        notes: "merged version into target story",
        metadata: { strategy: "keep_both" }
      });

      expect(createMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "u1",
          actionType: "MERGE_APPLIED",
          entityType: "story",
          entityId: "s1",
          notes: "merged version into target story",
          metadata: { strategy: "keep_both" }
        })
      });
    });

    it("accepts write without optional userId and metadata fields", async () => {
      const createMock = jest.fn().mockResolvedValue({ id: "log-2" });
      const cacheMock = { invalidatePatterns: jest.fn().mockResolvedValue(undefined) };
      const service = new AuditLogsService(
        { immutableAuditLog: { create: createMock } } as any,
        cacheMock as any
      );

      await service.write({
        actionType: "AUTH_LOGIN_SUCCESS",
        entityType: "session",
        notes: "successful login"
      });

      expect(createMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actionType: "AUTH_LOGIN_SUCCESS",
          entityType: "session",
          notes: "successful login"
        })
      });
    });

    it("invalidates report and transaction history cache patterns after write", async () => {
      const createMock = jest.fn().mockResolvedValue({ id: "log-3" });
      const invalidateMock = jest.fn().mockResolvedValue(undefined);
      const service = new AuditLogsService(
        { immutableAuditLog: { create: createMock } } as any,
        { invalidatePatterns: invalidateMock } as any
      );

      await service.write({ actionType: "PERMISSION_CHANGE", entityType: "role", notes: "perm update" });

      expect(invalidateMock).toHaveBeenCalledWith(
        expect.arrayContaining(["hot:reports:audit:*", "hot:transactions:history:*"])
      );
    });

    it("invalidates cache even when no metadata is provided", async () => {
      const createMock = jest.fn().mockResolvedValue({ id: "log-4" });
      const invalidateMock = jest.fn().mockResolvedValue(undefined);
      const service = new AuditLogsService(
        { immutableAuditLog: { create: createMock } } as any,
        { invalidatePatterns: invalidateMock } as any
      );

      await service.write({ actionType: "AUTH_LOGOUT", entityType: "session", notes: "logged out" });

      expect(invalidateMock).toHaveBeenCalledTimes(1);
    });

    it("creates log entry before invalidating cache", async () => {
      const callOrder: string[] = [];
      const createMock = jest.fn().mockImplementation(async () => { callOrder.push("create"); return { id: "log-5" }; });
      const invalidateMock = jest.fn().mockImplementation(async () => { callOrder.push("invalidate"); });
      const service = new AuditLogsService(
        { immutableAuditLog: { create: createMock } } as any,
        { invalidatePatterns: invalidateMock } as any
      );

      await service.write({ actionType: "CHARGE_APPROVED", entityType: "transaction", notes: "approved" });

      expect(callOrder).toEqual(["create", "invalidate"]);
    });
  });
});
