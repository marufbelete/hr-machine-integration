import { Injectable } from '@nestjs/common';
import { AddUserToMachineDto, UpdateUserOnMachineDto, DeleteUserFromMachineDto, GetMachineLogsDto, EmployeeCodeDto } from './dtos/hr-machine.dto';
import { MachineStrategyFactory } from './machine-strategy.factory';
import axios from "../http_client";
import { ConfigService } from '@nestjs/config';

@Injectable()
export class HrMachineService {
  constructor(
    private readonly strategyFactory: MachineStrategyFactory,
    private readonly configService: ConfigService,
  ) {}

  async addUserToMachine(param: AddUserToMachineDto, machineType: string) {
    const strategy = this.strategyFactory.getStrategy(machineType);
    return strategy.addUser(param);
  }

  async fetchBulkUsers(employeeCode: EmployeeCodeDto): Promise<AddUserToMachineDto[]> {
    console.log(employeeCode);
    const API_BASE_URL = this.configService.get<string>('CLOUD_URL');
    
    const params = employeeCode?.employeeCode?.trim() 
        ? { employeeCode: employeeCode.employeeCode } 
        : {};
    
    const res = await axios.get(`${API_BASE_URL}/hr/bulk_user`, { params });
    return res.data;
}

  async addUsersBulk(users: AddUserToMachineDto[], machineType: string) {
    const strategy = this.strategyFactory.getStrategy(machineType);
    const results = [];
    for (const param of users) {
      try {
        const result = await strategy.addUser(param);
        results.push({ success: true, result });
      } catch (error) {
        console.log(error)
        results.push({ success: false, error: error?.response?.data || error.message });
      }
    }
    return results;
  }

  async fetchAndAddUsersBulk(params: EmployeeCodeDto, machineType: string) {
    const users = await this.fetchBulkUsers(params);
    console.log(users)
    const strategy = this.strategyFactory.getStrategy(machineType);
    const results = [];
    for (const param of users!) {
      try {
        const result = await strategy.addUser(param);
        results.push({ success: true, result });
      } catch (error) {
        console.log(error)
        results.push({ success: false, error: error?.response?.data || error.message });
      }
    }
    return results;
  }

  async updateUserOnMachine(param: UpdateUserOnMachineDto, machineType: string) {
    const strategy = this.strategyFactory.getStrategy(machineType);
    return strategy.updateUser(param);
  }

  async deleteUserFromMachine(param: DeleteUserFromMachineDto, machineType: string) {
    const strategy = this.strategyFactory.getStrategy(machineType);
    return strategy.deleteUser(param);
  }

  async getMachineLogs(machineType: string) {
    const strategy = this.strategyFactory.getStrategy(machineType);
    return strategy.getLogs();
  }
  
} 