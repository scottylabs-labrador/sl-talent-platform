// Lazy ioredis singleton. Shared by session state (session:{screenId}) and the
// synthesis job list (jobs:synthesis). Never connects at import time.

import { Redis } from 'ioredis';
import { log } from './log.js';

let _redis: Redis | undefined;

export function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error('REDIS_URL is not set; voice-gateway requires Redis.');
    }
    _redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    _redis.on('error', (e) => log.error('redis error', e));
  }
  return _redis;
}

export async function closeRedis(): Promise<void> {
  if (_redis) {
    try {
      await _redis.quit();
    } catch {
      _redis.disconnect();
    }
    _redis = undefined;
  }
}
