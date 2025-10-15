import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HrMachineService } from './hr-machine.service';
import { HrMachineController } from './hr-machine.controller';
import { DahuaMachineService } from './dahua-machine.service';
import { ZktMachineService } from './zkt-machine.service';
import { HikvisionMachineService } from './hikvision-machine.service';
import { MachineStrategyFactory } from './machine-strategy.factory';
import { BotService } from './bot.service';

@Module({
  imports: [ConfigModule],
  controllers: [HrMachineController],
  providers: [
    HrMachineService,
    DahuaMachineService,
    ZktMachineService,
    MachineStrategyFactory,
    HikvisionMachineService,
    BotService,
  ],
  exports: [HrMachineService],
})
export class HrModule {} 