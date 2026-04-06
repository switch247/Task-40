import { HttpException } from "@nestjs/common";
import { RateLimitGuard } from "../src/modules/rate-limit/rate-limit.guard";

describe("RateLimitGuard", () => {
  it("uses per-user configured limit", async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false)
    } as any;
    const redis = {
      raw: {
        incr: jest.fn().mockResolvedValue(3),
        expire: jest.fn().mockResolvedValue(1)
      }
    } as any;
    const limits = {
      getPerUserLimit: jest.fn().mockResolvedValue(2)
    } as any;
    const guard = new RateLimitGuard(reflector, redis, limits);

    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ auth: { userId: "u1" } }) })
    } as any;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(HttpException);
  });

  it("skips throttling when skip metadata is set", async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true)
    } as any;
    const redis = { raw: { incr: jest.fn(), expire: jest.fn() } } as any;
    const limits = { getPerUserLimit: jest.fn() } as any;
    const guard = new RateLimitGuard(reflector, redis, limits);

    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({}) })
    } as any;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redis.raw.incr).not.toHaveBeenCalled();
  });
});
