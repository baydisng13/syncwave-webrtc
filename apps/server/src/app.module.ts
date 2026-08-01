import { Module } from '@nestjs/common'
import { SignalingGateway } from './signaling/signaling.gateway'

@Module({
  providers: [SignalingGateway],
})
export class AppModule {}
