import mongoose from 'mongoose';
import { readConfig } from './config.js';
import { createApp } from './app.js';

try {
  const config = readConfig();
  mongoose.set('bufferCommands', false);
  await mongoose.connect(config.uri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 10000, maxPoolSize: 20 });
  const app = createApp(config);
  const server = app.listen(config.port, config.host, () => console.log('API ready on configured loopback/private endpoint'));
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
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
