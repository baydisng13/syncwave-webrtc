import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  const origin = process.env.CORS_ORIGIN?.split(',') ?? '*'
  app.enableCors({ origin })
  const port = Number(process.env.PORT ?? 4000)
  await app.listen(port)
  // eslint-disable-next-line no-console
  console.log(`[syncwave] signaling server on :${port}`)
}

void bootstrap()
