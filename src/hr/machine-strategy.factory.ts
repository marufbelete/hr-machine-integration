import { Injectable } from '@nestjs/common';
import { AttendanceMachineStrategy } from './machine-strategy.interface';
import { DahuaMachineService } from './dahua-machine.service';
import { ZktMachineService } from './zkt-machine.service';
import { HikvisionMachineService } from './hikvision-machine.service';

@Injectable()
export class MachineStrategyFactory {
  constructor(
    private readonly dahua: DahuaMachineService,
    private readonly zkt: ZktMachineService,
    private readonly hikvision: HikvisionMachineService,
  ) {}

  getStrategy(machineType: string): AttendanceMachineStrategy {
    switch (machineType) {
      case 'DAHUA':
        return this.dahua;
      case 'ZKT':
        return this.zkt;
      case 'HIKVISION':
        return this.hikvision;
      default:
        throw new Error('Unsupported machine type');
    }
  }
} 