import { Redis } from 'ioredis'

const redis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,

});

redis.on("connect", () => {
  console.log("Redis connected");
});

redis.on("error", (error: Error) => {
  console.error("Redis error:", error);
});

export default redis;