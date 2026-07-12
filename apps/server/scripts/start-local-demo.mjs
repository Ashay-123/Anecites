process.env.NODE_ENV ??= "development";
process.env.API_HOST = "127.0.0.1";
process.env.API_PORT ??= "3000";
process.env.APP_ORIGIN ??= "http://127.0.0.1:5173";
process.env.LOCAL_DEMO_ENABLED = "true";
process.env.DATABASE_URL ??= "postgresql://anecites:anecites_dev_password@127.0.0.1:5432/anecites";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.RABBITMQ_URL ??= "amqp://anecites:anecites_dev_password@127.0.0.1:5672";
process.env.AUTH_JWT_SECRET ??= "local_demo_auth_secret_change_me_minimum_32_characters";
process.env.CODE_EXECUTION_PROVIDER ??= "piston";
process.env.CODE_EXECUTION_ALLOWED_LANGUAGE_IDS ??= "63,71";
process.env.PISTON_BASE_URL ??= "http://127.0.0.1:2000";
process.env.LIVEKIT_URL ??= "ws://127.0.0.1:7880";
process.env.LIVEKIT_API_URL ??= "http://127.0.0.1:7880";
process.env.LIVEKIT_API_KEY ??= "devkey";
process.env.LIVEKIT_API_SECRET ??= "devsecret_livekit_local_minimum_32_chars";

const { createApp, loadServerConfig, consoleLogger } = await import("../dist/index.js");

const config = loadServerConfig();
const app = createApp(config);

app.listen(config.apiPort, config.apiHost, () => {
  consoleLogger.info("server.local_demo_started", {
    host: config.apiHost,
    port: config.apiPort,
  });
});
