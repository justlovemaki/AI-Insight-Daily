import dotenv from 'dotenv';
import { createServer } from './api/server.js';
import cron from 'node-cron';
import { LocalStore } from './services/LocalStore.js';
import { ServiceContext } from './services/ServiceContext.js';

dotenv.config();

async function bootstrap() {
  const store = new LocalStore();
  await store.init();

  // --- Initialize Service Context (Singleton) ---
  const context = await ServiceContext.getInstance(store);

  // Setup Scheduler
  cron.schedule('0 8 * * *', async () => {
    console.log('Running daily ingestion task...');
    // 每次执行时都从 context 获取最新的 taskService
    await context.taskService.runDailyIngestion();
    
    if (context.aiProvider) {
      console.log('Generating auto-summary and committing...');
    }
  }, {
    timezone: 'Asia/Shanghai'
  });

  const server = await createServer(store);
  const port = parseInt(process.env.PORT || '3000');

  try {
    await server.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening on port ${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

bootstrap();
