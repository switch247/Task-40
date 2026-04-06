import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ApiV1Module } from "./api/v1/api-v1.module";
import { ApiV2Module } from "./api/v2/api-v2.module";
import { AdminModule } from "./modules/admin/admin.module";
import { AuditLogsModule } from "./modules/audit-logs/audit-logs.module";
import { CleansingModule } from "./modules/cleansing/cleansing.module";
import { DedupModule } from "./modules/dedup/dedup.module";
import { FreezesModule } from "./modules/freezes/freezes.module";
import { HealthModule } from "./modules/health/health.module";
import { IngestionModule } from "./modules/ingestion/ingestion.module";
import { JobsModule } from "./modules/jobs/jobs.module";
import { LedgerModule } from "./modules/ledger/ledger.module";
import { MergeModule } from "./modules/merge/merge.module";
import { ObservabilityModule } from "./modules/observability/observability.module";
import { PaymentChannelsModule } from "./modules/payment-channels/payment-channels.module";
import { RedisModule } from "./modules/cache/redis.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { RateLimitModule } from "./modules/rate-limit/rate-limit.module";
import { RefundsModule } from "./modules/refunds/refunds.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { RolesPermissionsModule } from "./modules/roles-permissions/roles-permissions.module";
import { StoriesModule } from "./modules/stories/stories.module";
import { StoryVersionsModule } from "./modules/story-versions/story-versions.module";
import { TransactionsModule } from "./modules/transactions/transactions.module";
import { UsersModule } from "./modules/users/users.module";
import { SecurityModule } from "./security/security.module";
import { RateLimitGuard } from "./modules/rate-limit/rate-limit.guard";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    RateLimitModule,
    SecurityModule,
    UsersModule,
    RolesPermissionsModule,
    StoriesModule,
    StoryVersionsModule,
    IngestionModule,
    CleansingModule,
    DedupModule,
    MergeModule,
    TransactionsModule,
    RefundsModule,
    FreezesModule,
    LedgerModule,
    PaymentChannelsModule,
    AuditLogsModule,
    ReportsModule,
    AdminModule,
    JobsModule,
    ObservabilityModule,
    HealthModule,
    ApiV1Module,
    ApiV2Module
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard
    }
  ]
})
export class AppModule {}
