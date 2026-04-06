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
});
