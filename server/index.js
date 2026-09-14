import mongoose from 'mongoose';
import { readConfig } from './config.js';
import { createApp } from './app.js';
import {connectDatabase, startExpiryCleanup} from './database/index.js';

try {
  const config = readConfig();
  mongoose.set('bufferCommands', false);
  await connectDatabase(config.uri, {maxPoolSize:20});
  const stopCleanup = config.writeMode === 'readwrite' ? startExpiryCleanup() : () => {};
  const app = createApp(config);
  const server = app.listen(config.port, config.host, () => console.log('API ready on configured loopback/private endpoint'));
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    stopCleanup();
    const timer = setTimeout(() => process.exit(1), 10000);
    timer.unref();
    server.close(async () => { await mongoose.disconnect(); clearTimeout(timer); });
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
} catch (error) {
  console.error('API startup failed:', error.name === 'MongooseServerSelectionError' ? 'Database unavailable' : error.message);
  await mongoose.disconnect();
  process.exitCode = 1;
}
