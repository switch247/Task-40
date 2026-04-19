import { StoriesService } from "../src/modules/stories/stories.service";

describe("StoriesService", () => {
  describe("listStories", () => {
    it("returns all stories as items array when no query provided", async () => {
      const mockStories = [
        { id: "s1", latestTitle: "Story One", canonicalUrl: "https://example.local/1", source: "wire", status: "active", updatedAt: new Date(), createdAt: new Date(), versions: [{ createdAt: new Date(), versionNumber: 2 }] },
        { id: "s2", latestTitle: "Story Two", canonicalUrl: "https://example.local/2", source: "wire", status: "active", updatedAt: new Date(), createdAt: new Date(), versions: [] }
      ];

      const service = new StoriesService({
        story: {
          findMany: jest.fn().mockResolvedValue(mockStories)
        }
      } as any);

      const result = await service.listStories();
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe("s1");
      expect(result.items[0].latestVersionNumber).toBe(2);
      expect(result.items[1].latestVersionNumber).toBeNull();
    });

    it("passes query filter to prisma when query string provided", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const service = new StoriesService({ story: { findMany } } as any);

      await service.listStories("breaking news");

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ OR: expect.any(Array) })
        })
      );
    });

    it("strips leading/trailing whitespace from query before passing to prisma", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const service = new StoriesService({ story: { findMany } } as any);

      await service.listStories("  trimmed  ");

      const callArg = findMany.mock.calls[0][0] as { where?: unknown };
      expect(callArg.where).toBeTruthy();
    });

    it("passes undefined where clause when query trims to empty string", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const service = new StoriesService({ story: { findMany } } as any);

      await service.listStories("   ");

      const callArg = findMany.mock.calls[0][0] as { where?: unknown };
      expect(callArg.where).toBeUndefined();
    });

    it("maps latestVersionAt to null when story has no versions", async () => {
      const mockStory = { id: "s3", latestTitle: "No Versions", canonicalUrl: "https://example.local/3", source: "wire", status: "active", updatedAt: new Date(), createdAt: new Date(), versions: [] };
      const service = new StoriesService({ story: { findMany: jest.fn().mockResolvedValue([mockStory]) } } as any);

      const result = await service.listStories();
      expect(result.items[0].latestVersionAt).toBeNull();
    });
  });

  describe("upsertStory", () => {
    it("creates new story when no existing story matches canonicalUrl", async () => {
      const createdStory = { id: "s-new", name: "New Story" };
      const prisma = {
        story: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue(createdStory)
        }
      } as any;
      const service = new StoriesService(prisma);

      const result = await service.upsertStory({
        title: "New Story",
        body: "Body",
        source: "wire",
        canonicalUrl: "https://example.local/new",
      });

      expect(prisma.story.create).toHaveBeenCalled();
      expect(result.id).toBe("s-new");
    });

    it("updates existing story when canonicalUrl matches", async () => {
      const existingStory = { id: "s-existing" };
      const updatedStory = { id: "s-existing" };
      const prisma = {
        story: {
          findFirst: jest.fn().mockResolvedValue(existingStory),
          update: jest.fn().mockResolvedValue(updatedStory)
        }
      } as any;
      const service = new StoriesService(prisma);

      const result = await service.upsertStory({
        title: "Updated Title",
        body: "Updated Body",
        source: "wire",
        canonicalUrl: "https://example.local/existing"
      });

      expect(prisma.story.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "s-existing" } })
      );
      expect(result.id).toBe("s-existing");
    });

    it("does not call create when existing story is found", async () => {
      const prisma = {
        story: {
          findFirst: jest.fn().mockResolvedValue({ id: "s-found" }),
          create: jest.fn(),
          update: jest.fn().mockResolvedValue({ id: "s-found" })
        }
      } as any;
      const service = new StoriesService(prisma);

      await service.upsertStory({ title: "T", body: "B", source: "wire", canonicalUrl: "https://x.local/" });
      expect(prisma.story.create).not.toHaveBeenCalled();
    });
  });

  describe("createVersion", () => {
    it("creates version with versionNumber 1 when no prior versions exist", async () => {
      const created = { id: "v1", versionNumber: 1 };
      const prisma = {
        storyVersion: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue(created)
        }
      } as any;
      const service = new StoriesService(prisma);

      const result = await service.createVersion({
        storyId: "s1",
        title: "T",
        body: "B",
        source: "wire",
        rawUrl: "https://x.local/",
        canonicalUrl: "https://x.local/",
        contentHash: "hash",
        simhash: "1",
        minhashSignature: "1,2",
        duplicateFlag: false,
        anomalyFlag: false
      });

      expect(prisma.storyVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ versionNumber: 1 }) })
      );
      expect(result.versionNumber).toBe(1);
    });

    it("increments versionNumber based on latest existing version", async () => {
      const created = { id: "v3", versionNumber: 3 };
      const prisma = {
        storyVersion: {
          findFirst: jest.fn().mockResolvedValue({ versionNumber: 2 }),
          create: jest.fn().mockResolvedValue(created)
        }
      } as any;
      const service = new StoriesService(prisma);

      const result = await service.createVersion({
        storyId: "s1",
        title: "T v3",
        body: "B v3",
        source: "wire",
        rawUrl: "https://x.local/",
        canonicalUrl: "https://x.local/",
        contentHash: "hash3",
        simhash: "3",
        minhashSignature: "3,4",
        duplicateFlag: false,
        anomalyFlag: false
      });

      expect(prisma.storyVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ versionNumber: 3 }) })
      );
      expect(result.versionNumber).toBe(3);
    });
  });
});
