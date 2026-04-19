import { HotReadCacheService } from "../src/modules/cache/hot-read-cache.service";

function makeRedis(overrides?: Partial<{
  getHotRead: jest.Mock;
  setHotRead: jest.Mock;
  scanKeys: jest.Mock;
  delMany: jest.Mock;
}>) {
  return {
    getHotRead: jest.fn().mockResolvedValue(null),
    setHotRead: jest.fn().mockResolvedValue(undefined),
    scanKeys: jest.fn().mockResolvedValue([]),
    delMany: jest.fn().mockResolvedValue(undefined),
    ...overrides
  } as any;
}

describe("HotReadCacheService", () => {
  describe("getOrLoad", () => {
    it("returns parsed cached value and skips loader on cache hit", async () => {
      const cached = { data: "cached-payload" };
      const redis = makeRedis({ getHotRead: jest.fn().mockResolvedValue(JSON.stringify(cached)) });
      const service = new HotReadCacheService(redis);
      const loader = jest.fn();

      const result = await service.getOrLoad("key:1", loader);

      expect(result).toEqual(cached);
      expect(loader).not.toHaveBeenCalled();
    });

    it("calls loader and caches result when cache miss", async () => {
      const loaded = { data: "from-db" };
      const redis = makeRedis({ getHotRead: jest.fn().mockResolvedValue(null) });
      const service = new HotReadCacheService(redis);
      const loader = jest.fn().mockResolvedValue(loaded);

      const result = await service.getOrLoad("key:2", loader);

      expect(loader).toHaveBeenCalledTimes(1);
      expect(result).toEqual(loaded);
      expect(redis.setHotRead).toHaveBeenCalledWith("key:2", JSON.stringify(loaded), expect.any(Number));
    });

    it("calls loader without caching when redis getHotRead throws", async () => {
      const loaded = { data: "fallback" };
      const redis = makeRedis({ getHotRead: jest.fn().mockRejectedValue(new Error("redis down")) });
      const service = new HotReadCacheService(redis);
      const loader = jest.fn().mockResolvedValue(loaded);

      const result = await service.getOrLoad("key:3", loader);

      expect(loader).toHaveBeenCalledTimes(1);
      expect(result).toEqual(loaded);
    });

    it("returns loaded value even when setHotRead fails", async () => {
      const loaded = { data: "value" };
      const redis = makeRedis({
        getHotRead: jest.fn().mockResolvedValue(null),
        setHotRead: jest.fn().mockRejectedValue(new Error("set failed"))
      });
      const service = new HotReadCacheService(redis);

      const result = await service.getOrLoad("key:4", async () => loaded);

      expect(result).toEqual(loaded);
    });

    it("uses provided ttlSeconds when setting cache value", async () => {
      const redis = makeRedis({ getHotRead: jest.fn().mockResolvedValue(null) });
      const service = new HotReadCacheService(redis);

      await service.getOrLoad("key:5", async () => ({ v: 1 }), 60);

      expect(redis.setHotRead).toHaveBeenCalledWith("key:5", expect.any(String), 60);
    });

    it("uses default ttl of 300 seconds when ttlSeconds not provided", async () => {
      const redis = makeRedis({ getHotRead: jest.fn().mockResolvedValue(null) });
      const service = new HotReadCacheService(redis);

      await service.getOrLoad("key:6", async () => ({ v: 2 }));

      expect(redis.setHotRead).toHaveBeenCalledWith("key:6", expect.any(String), 300);
    });
  });

  describe("invalidatePatterns", () => {
    it("scans and deletes keys matching each pattern", async () => {
      const redis = makeRedis({
        scanKeys: jest.fn().mockImplementation(async (pattern: string) => {
          if (pattern === "hot:reports:*") return ["hot:reports:1", "hot:reports:2"];
          if (pattern === "hot:transactions:*") return ["hot:transactions:1"];
          return [];
        })
      });
      const service = new HotReadCacheService(redis);

      await service.invalidatePatterns(["hot:reports:*", "hot:transactions:*"]);

      expect(redis.delMany).toHaveBeenCalledWith(["hot:reports:1", "hot:reports:2"]);
      expect(redis.delMany).toHaveBeenCalledWith(["hot:transactions:1"]);
    });

    it("continues to next pattern when scan throws for one pattern", async () => {
      const redis = makeRedis({
        scanKeys: jest.fn()
          .mockRejectedValueOnce(new Error("scan failed"))
          .mockResolvedValueOnce(["key:a"])
      });
      const service = new HotReadCacheService(redis);

      await expect(service.invalidatePatterns(["broken:*", "ok:*"])).resolves.not.toThrow();
      expect(redis.delMany).toHaveBeenCalledWith(["key:a"]);
    });

    it("skips delMany when scan returns empty array", async () => {
      const redis = makeRedis({ scanKeys: jest.fn().mockResolvedValue([]) });
      const service = new HotReadCacheService(redis);

      await service.invalidatePatterns(["empty:*"]);

      expect(redis.delMany).toHaveBeenCalledWith([]);
    });

    it("handles empty patterns array without error", async () => {
      const redis = makeRedis();
      const service = new HotReadCacheService(redis);

      await expect(service.invalidatePatterns([])).resolves.not.toThrow();
      expect(redis.scanKeys).not.toHaveBeenCalled();
      expect(redis.delMany).not.toHaveBeenCalled();
    });
  });
});
