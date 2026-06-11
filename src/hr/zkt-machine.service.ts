import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { AttendanceMachineStrategy } from './machine-strategy.interface';
import { AddUserToMachineDto, UpdateUserOnMachineDto, DeleteUserFromMachineDto, GetMachineLogsDto } from './dtos/hr-machine.dto';
import axios from "../http_client";
import { ConfigService } from '@nestjs/config';

const ZKT_PORT = 8090; // Use the same port for all ZKT devices

@Injectable()
export class ZktMachineService implements AttendanceMachineStrategy {
  private readonly username: string;
  private readonly password: string;
  private get cloudUrl(): string {
    return this.configService.get<string>('CLOUD_URL');
  }

  constructor(private readonly configService: ConfigService) {
    this.username = this.configService.get<string>('ZKT_USERNAME') || '';
    this.password = this.configService.get<string>('ZKT_PASSWORD') || '';
  }

  private async getAuthToken(baseUrl: string): Promise<string> {
    const res = await axios.post(`${baseUrl}/jwt-api-token-auth/`, {
      username: this.username,
      password: this.password,
    }, {
      headers: { 'Content-Type': 'application/json' },
    });
    return res.data.token;
  }

  private async getDeviceIPsByCodes(deviceCodes: string[]): Promise<{ code: string; ip: string }[]> {
    if (!deviceCodes.length) return [];
    const codes = deviceCodes.join(',');
    const res = await axios.get(`${this.cloudUrl}/hr/device/code?code=${codes}`);
    return res.data;
  }

  async addUser(param: AddUserToMachineDto) {
    // param: { name, userId, identification, startDate, endDate, devices: [{ name, code }] }
    const devices = (param.devices || []).map(d => typeof d === 'string' ? { code: d } : d);
    const deviceInfos = await this.getDeviceIPsByCodes(devices.map(d => d.code));
    const results = [];
    for (const device of deviceInfos) {
      const baseUrl = `http://${device.ip}:${ZKT_PORT}`;
      const token = await this.getAuthToken(baseUrl);
      const body: any = {
        emp_code: param.userId,
        first_name: param.name,
        last_name: param.name,
        department: 1,
        area: [device.code],
        // Optionally, you can add more fields if BioTime supports them
      };
      try {
        const res = await axios.post(`${baseUrl}/personnel/api/employees/`, body, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `JWT ${token}`,
          },
        });
        // Sync to cloud
        try {
          await axios.post(`${this.cloudUrl}/hr/identification`, {
            description: 'Biometric Id',
            type: 'LKUP000000525',
            Index: 0,
            idNumber: param.identification,
            issueDate: param.startDate,
            expiryDate: param.endDate,
            reference: param.userId,
            remark: `${res.data?.emp_code || ''}/${device.code}`,
          });
        } catch (cloudErr) {
          console.error('Cloud sync failed (addUser):', cloudErr?.response?.data || cloudErr.message);
        }
        results.push({ device: device.code, result: res.data });
      } catch (error) {
        results.push({ device: device.code, error: error.response?.data || error.message });
      }
    }
    return results;
  }

  async updateUser(param: UpdateUserOnMachineDto) {
    // Fetch identification records from the cloud to get emp_code/deviceCode mapping
    const identificationRes = await axios.get(`${this.cloudUrl}/hr/identification?reference=${param.userId}&description=Biometric Id`);
    const identification = identificationRes.data;
    const deviceRecNoMap: Record<string, string> = {};
    const deviceCodes: string[] = [];
    identification.forEach((id: any) => {
      if (id.remark) {
        const [emp_code, deviceCode] = id.remark.split('/');
        deviceRecNoMap[deviceCode] = emp_code;
        deviceCodes.push(deviceCode);
      }
    });
    const deviceInfos = await this.getDeviceIPsByCodes(deviceCodes);
    const results = [];
    for (const device of deviceInfos) {
      const baseUrl = `http://${device.ip}:${ZKT_PORT}`;
      const token = await this.getAuthToken(baseUrl);
      const emp_code = deviceRecNoMap[device.code];
      if (!emp_code) {
        results.push({ device: device.code, error: 'Employee not found for this device' });
        continue;
      }
      // Find employee by emp_code
      const listRes = await axios.get(`${baseUrl}/personnel/api/employees/?emp_code=${emp_code}`, {
        headers: { Authorization: `JWT ${token}` },
      });
      const emp = listRes.data.data?.[0];
      if (!emp) {
        results.push({ device: device.code, error: 'Employee not found' });
        continue;
      }
      try {
        const res = await axios.patch(`${baseUrl}/personnel/api/employees/${emp.id}/`, {
          first_name: param.name,
          last_name: param.name,
        }, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `JWT ${token}`,
          },
        });
        results.push({ device: device.code, result: res.data });
      } catch (error) {
        results.push({ device: device.code, error: error.response?.data || error.message });
      }
    }
    return results;
  }

  async deleteUser(param: DeleteUserFromMachineDto) {
    // Fetch identification records from the cloud to get emp_code/deviceCode mapping
    const identificationRes = await axios.get(`${this.cloudUrl}/hr/identification?reference=${param.code}&description=Biometric Id`);
    const identification = identificationRes.data;
    const deviceRecNoMap: Record<string, string> = {};
    const deviceCodes: string[] = [];
    identification.forEach((id: any) => {
      if (id.remark) {
        const [emp_code, deviceCode] = id.remark.split('/');
        deviceRecNoMap[deviceCode] = emp_code;
        deviceCodes.push(deviceCode);
      }
    });
    const deviceInfos = await this.getDeviceIPsByCodes(deviceCodes);
    const results = [];
    for (const device of deviceInfos) {
      const baseUrl = `http://${device.ip}:${ZKT_PORT}`;
      const token = await this.getAuthToken(baseUrl);
      const emp_code = deviceRecNoMap[device.code];
      if (!emp_code) {
        results.push({ device: device.code, error: 'Employee not found for this device' });
        continue;
      }
      // Find employee by emp_code
      const listRes = await axios.get(`${baseUrl}/personnel/api/employees/?emp_code=${emp_code}`, {
        headers: { Authorization: `JWT ${token}` },
      });
      const emp = listRes.data.data?.[0];
      if (!emp) {
        results.push({ device: device.code, error: 'Employee not found' });
        continue;
      }
      try {
        await axios.delete(`${baseUrl}/personnel/api/employees/${emp.id}/`, {
          headers: { Authorization: `JWT ${token}` },
        });
        try {
          await axios.delete(`${this.cloudUrl}/hr/identification`, {
            data: { reference: param.code, type: 'LKUP000000525' },
          });
        } catch (cloudErr) {
          console.error('Cloud sync failed (deleteUser):', cloudErr?.response?.data || cloudErr.message);
        }
        results.push({ device: device.code, result: 'Employee deleted' });
      } catch (error) {
        results.push({ device: device.code, error: error.response?.data || error.message });
      }
    }
    return results;
  }

  async getLogs() {
    // Fetch identification records from the cloud to get device codes
    const reference = '';
    const identificationRes = await axios.get(`${this.cloudUrl}/hr/identification?reference=${reference}&description=Biometric Id`);
    const identification = identificationRes.data;
    const deviceCodes: string[] = [];
    identification.forEach((id: any) => {
      if (id.remark) {
        const [, deviceCode] = id.remark.split('/');
        deviceCodes.push(deviceCode);
      }
    });
    const deviceInfos = await this.getDeviceIPsByCodes(deviceCodes);
    const allLogs = [];
    for (const device of deviceInfos) {

      const lastTimeStamp = await axios.get(`${this.cloudUrl}/hr/sync/attendance/last-time?machineId=${device.code}`);
      const time_stamp = lastTimeStamp?.data?.length ? this.sqlDatetimeToUnix(lastTimeStamp.data[0]?.timestamp) : null;
    
      const baseUrl = `http://${device.ip}:${ZKT_PORT}`;
      const token = await this.getAuthToken(baseUrl);
      const params: any = {};
      if (time_stamp) {
        params.start_time = time_stamp;
      }
      try {
        const res = await axios.get(`${baseUrl}/iclock/api/transactions/`, {
          headers: { Authorization: `JWT ${token}` },
          params,
        });
        allLogs.push(...(res.data.data || []));
      } catch (error) {
        allLogs.push({ device: device.code, error: error.response?.data || error.message });
      }
    }
    return allLogs;
  }

  sqlDatetimeToUnix(dt: string){
    return Math.floor((new Date(dt).getTime() / 1000) + 1);
  }
} 