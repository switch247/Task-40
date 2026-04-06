import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import * as request from "supertest";
import { PaymentChannelsV1Controller } from "../src/api/v1/payment-channels-v1.controller";
import { RedisService } from "../src/modules/cache/redis.service";
import { RateLimitGuard } from "../src/modules/rate-limit/rate-limit.guard";
import { RateLimitService } from "../src/modules/rate-limit/rate-limit.service";
import { PaymentChannelsService } from "../src/modules/payment-channels/payment-channels.service";

describe("Global rate limit guard (e2e)", () => {
  let app: INestApplication;
  const counters: Record<string, number> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentChannelsV1Controller],
      providers: [
        Reflector,
        RateLimitGuard,
        {
          provide: PaymentChannelsService,
          useValue: {
            processSignedCharge: jest.fn().mockResolvedValue({ status: "ok", idempotent: false, transactionId: "tx-1" })
          }
        },
        {
          provide: RedisService,
          useValue: {
            raw: {
              incr: jest.fn().mockImplementation((key: string) => {
                counters[key] = (counters[key] ?? 0) + 1;
                return counters[key];
              }),
              expire: jest.fn().mockResolvedValue(1)
            }
          }
        },
        {
          provide: RateLimitService,
          useValue: {
            getPerUserLimit: jest.fn().mockResolvedValue(60)
          }
        }
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalGuards(app.get(RateLimitGuard));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 429 on the 61st request within one minute for a non-auth endpoint", async () => {
    const server = app.getHttpServer();

    for (let i = 1; i <= 60; i++) {
      const response = await request(server)
        .post("/payment-channels/prepaid_balance/charge")
        .send({ bundleCount: 1, amountCents: 100, storyVersionId: `sv-${i}` });
      expect(response.status).toBe(201);
    }

    const throttled = await request(server)
      .post("/payment-channels/prepaid_balance/charge")
      .send({ bundleCount: 1, amountCents: 100, storyVersionId: "sv-61" });
    expect(throttled.status).toBe(429);
  });

  it("isolates unauthenticated buckets by client identity so separate IPs do not interfere", async () => {
    const server = app.getHttpServer();

    for (let i = 1; i <= 60; i++) {
      const ipA = await request(server)
        .post("/payment-channels/prepaid_balance/charge")
        .set("x-forwarded-for", "198.51.100.10")
        .set("user-agent", "agent-a")
        .send({ bundleCount: 1, amountCents: 100, storyVersionId: `a-${i}` });
      expect(ipA.status).toBe(201);

      const ipB = await request(server)
        .post("/payment-channels/prepaid_balance/charge")
        .set("x-forwarded-for", "203.0.113.55")
        .set("user-agent", "agent-b")
        .send({ bundleCount: 1, amountCents: 100, storyVersionId: `b-${i}` });
      expect(ipB.status).toBe(201);
    }

    const overA = await request(server)
      .post("/payment-channels/prepaid_balance/charge")
      .set("x-forwarded-for", "198.51.100.10")
      .set("user-agent", "agent-a")
      .send({ bundleCount: 1, amountCents: 100, storyVersionId: "a-over" });
    expect(overA.status).toBe(429);

    const overB = await request(server)
      .post("/payment-channels/prepaid_balance/charge")
      .set("x-forwarded-for", "203.0.113.55")
      .set("user-agent", "agent-b")
      .send({ bundleCount: 1, amountCents: 100, storyVersionId: "b-over" });
    expect(overB.status).toBe(429);
  });
});
