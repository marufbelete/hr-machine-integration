import { Controller, Post, Put, Delete, Get, Body, Param, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HrMachineService } from './hr-machine.service';
import { AddUserToMachineDto, UpdateUserOnMachineDto, DeleteUserFromMachineDto, GetMachineLogsDto, EmployeeCodeDto } from './dtos/hr-machine.dto';
import axios from "../http_client";

@Controller('hr')
export class HrMachineController {
  // private readonly machineType = 'HIKVISION';
  private readonly machineType = "DAHUA";
  constructor(
    private readonly hrMachineService: HrMachineService,
    private readonly configService: ConfigService,
  ) {}

  @Post('user')
  async addUserToMachine(@Body() dto: AddUserToMachineDto) {
    return this.hrMachineService.addUserToMachine(dto, this.machineType);
  }

  @Post('user/bulk')
  async addUsersBulk(@Body() dtos: AddUserToMachineDto[]) {
    return this.hrMachineService.addUsersBulk(dtos, this.machineType);
  }

  @Get('user/bulk/fetch')
  async fetchAndAddBulkUsers(@Query() query: EmployeeCodeDto) {
    return this.hrMachineService.fetchAndAddUsersBulk(query, this.machineType);
  }

  @Put('user')
  async updateUserOnMachine(@Body() dto: UpdateUserOnMachineDto) {
    return this.hrMachineService.updateUserOnMachine(dto, this.machineType);
  }

  @Delete('user/:code')
  async deleteUserFromMachine(@Param() params: DeleteUserFromMachineDto) {
    return this.hrMachineService.deleteUserFromMachine(params, this.machineType);
  }

  @Get('logs')
  async getMachineLogs(@Query() query: GetMachineLogsDto) {
    return this.hrMachineService.getMachineLogs(this.machineType);
  }
} 