import { ValidationPipe, VersioningType } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser = require("cookie-parser");
import helmet from "helmet";
import { AppModule } from "./app.module";
import { JsonExceptionFilter } from "./common/filters/json-exception.filter";
import { RedactionInterceptor } from "./common/interceptors/redaction.interceptor";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });
  const expressApp = app.getHttpAdapter().getInstance();
  const trustProxyEnv = process.env.TRUST_PROXY;
  if (!trustProxyEnv || trustProxyEnv === "false") {
    expressApp.set("trust proxy", false);
  } else if (trustProxyEnv === "true") {
    expressApp.set("trust proxy", 1);
  } else if (trustProxyEnv.includes(",")) {
    expressApp.set(
      "trust proxy",
      trustProxyEnv
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    );
  } else {
    expressApp.set("trust proxy", trustProxyEnv.trim());
  }

  const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-csrf-token"],
    optionsSuccessStatus: 204
  });

  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix("api");
  app.enableVersioning({
    type: VersioningType.URI,
    prefix: "v"
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true
    })
  );
  app.useGlobalFilters(new JsonExceptionFilter());
  app.useGlobalInterceptors(new RedactionInterceptor());

  const v1Config = new DocumentBuilder()
    .setTitle("SentinelDesk API v1")
    .setDescription("Offline local OpenAPI docs for v1")
    .setVersion("1.0")
    .addCookieAuth("sid")
    .addSecurity("csrf", {
      type: "apiKey",
      in: "header",
      name: "x-csrf-token"
    })
    .build();

  const v2Config = new DocumentBuilder()
    .setTitle("SentinelDesk API v2")
    .setDescription("Offline local OpenAPI docs for v2")
    .setVersion("2.0")
    .addCookieAuth("sid")
    .addSecurity("csrf", {
      type: "apiKey",
      in: "header",
      name: "x-csrf-token"
    })
    .build();

  const v1Doc = SwaggerModule.createDocument(app, v1Config);
  const v2Doc = SwaggerModule.createDocument(app, v2Config);

  SwaggerModule.setup("openapi/v1", app, v1Doc, { jsonDocumentUrl: "openapi/v1.json" });
  SwaggerModule.setup("openapi/v2", app, v2Doc, { jsonDocumentUrl: "openapi/v2.json" });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
