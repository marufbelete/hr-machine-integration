import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AttendanceMachineStrategy } from './machine-strategy.interface';
import { AddUserToMachineDto, UpdateUserOnMachineDto, DeleteUserFromMachineDto, GetMachineLogsDto } from './dtos/hr-machine.dto';
import axios from "../http_client";
import axiosDigest from 'axios-digest';
import * as https from 'https';

const client = new axiosDigest('admin', 'P@ssw0rd');
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

@Injectable()
export class DahuaMachineService implements AttendanceMachineStrategy {
  private get cloudUrl(): string {
    return this.configService.get<string>('CLOUD_URL');
  }

  constructor(private readonly configService: ConfigService) {
  }

  async getHrMachineIPs() {
    const res = await axios.get(`${this.cloudUrl}/hr/device?preference=PREFE000000057`);
    return res.data;
  }

  async checkDahuaConnection(ip: string, timeout = 5000): Promise<boolean> {
    try {
      await client.get(
        `http://${ip}/cgi-bin/global.cgi?action=getCurrentTime`,
        { httpsAgent }
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  async executeWithConnectionCheck<T>(ip: string, operation: () => Promise<T>, operationName: string, throwError = true): Promise<T | null> {
    const isConnected = await this.checkDahuaConnection(ip);
    const ips = await this.getHrMachineIPs();
    const deviceInfo = ips.find(e => e.ip === ip);
    const deviceName = deviceInfo ? deviceInfo.name : ip;
    if (!isConnected) {
      if (throwError) {
        throw new HttpException(`Dahua device at ${deviceName} is not reachable. Cannot execute ${operationName}`, HttpStatus.BAD_GATEWAY);
      } else {
        return null;
      }
    }
    try {
      return await operation();
    } catch (error) {
      if (throwError) throw error;
      return null;
    }
  }

  async addUser(param: AddUserToMachineDto) {
    const { userId, name, identification, startDate, endDate, devices } = param;
    const unreachableDevices = [];
    const reachableDevices = [];
    const results = [];
    const failedDevices = [];
  
    // 🔍 Check device reachability
    for (const device of devices) {
      try {
        const deviceInfoRes = await axios.get(`${this.cloudUrl}/hr/device/code?code=${device.code}`);
        const [device_info] = deviceInfoRes.data;
        param['ip'] = device_info.ip;
  
        const isConnected = await this.checkDahuaConnection(param['ip']);
        if (!isConnected) {
          unreachableDevices.push({
            deviceName: device.name,
            ip: param['ip'],
            error: 'Device not reachable',
          });
        } else {
          reachableDevices.push(device);
        }
      } catch (err) {
        unreachableDevices.push({
          deviceName: device.name,
          error: `Failed to fetch device info: ${err.message}`,
        });
      }
    }
  
    // ⚠️ Proceed even if some are unreachable
    if (reachableDevices.length === 0) {
      throw new HttpException(
        {
          message: 'All devices are unreachable. Cannot add user.',
          unreachableDevices,
        },
        HttpStatus.BAD_GATEWAY,
      );
    }
  
    // 🚀 Try adding user to each reachable device
    for (const device of reachableDevices) {
      try {
        const deviceInfoRes = await axios.get(`${this.cloudUrl}/hr/device/code?code=${device.code}`);
        const [device_info] = deviceInfoRes.data;
        const ip = device_info.ip;
  
        const result = await this.executeWithConnectionCheck(ip, async () => {
          const response = await client.get(
            `http://${ip}/cgi-bin/recordUpdater.cgi?action=insert&name=AccessControlCard&CardName=${encodeURIComponent(
              name,
            )}&CardNo=${identification}&UserID=${identification}&CardStatus=0&CardType=0&ValidDateStart=${startDate.replace(
              /-/g,
              '',
            )}&ValidDateEnd=${endDate.replace(/-/g, '')}`,
            { httpsAgent },
          );
          const [key, value] = response.data.trim().split('=');
          return { [key]: `${value}/${device.code}`, deviceName: device.name };
        }, 'addUserToDahua');
  
        if (result) {
          results.push({
            description: 'Biometric Id',
            type: 'LKUP000000525',
            Index: 0,
            idNumber: param.identification,
            issueDate: param.startDate,
            expiryDate: param.endDate,
            reference: param.userId,
            remark: result['RecNo'],
          });
        }
      } catch (error) {
        console.error(`❌ Failed to save user on device ${device.name}: ${error.message}`);
        failedDevices.push({
          deviceName: device.name,
          error: error.message,
        });
        // Continue to next device
        continue;
      }
    }
  
    // 🧾 Save successful results to cloud (if any)
    if (results.length > 0) {
      await axios.post(`${this.cloudUrl}/hr/identification`, results);
    }
  
    return {
      message: 'User added to some or all devices.',
      successfulDevices: results.map((r) => r.remark),
      failedDevices,
      unreachableDevices,
    };
  }
  

  async updateUser(param: UpdateUserOnMachineDto) {
    const { userId, name } = param;
    const identificationRes = await axios.get(`${this.cloudUrl}/hr/identification?reference=${userId}`);
    const identification = identificationRes.data;
    if (!identification?.length) return { message: 'user not found on device' };
    const deviceRecNoMap = {};
    identification.forEach(id => {
      if (id.remark) {
        const [recNo, deviceCode] = id.remark.split('/');
        deviceRecNoMap[deviceCode] = recNo;
      }
    });
    const userDeviceCodes = identification.map(e => e?.remark?.split('/')[1]);
    const deviceInfoRes = await axios.get(`${this.cloudUrl}/hr/device/code?code=${userDeviceCodes.join(',')}`);
    const deviceInfo = deviceInfoRes.data;
    const unreachableDevices = [];
    const reachableDevices = [];
    for (let device of deviceInfo) {
      const ip = device.ip;
      const isConnected = await this.checkDahuaConnection(ip);
      if (!isConnected) {
        unreachableDevices.push({ deviceName: device.name, ip, error: 'Device not reachable' });
      } else {
        reachableDevices.push({ ...device, recNo: deviceRecNoMap[device.code] });
      }
    }
    if (unreachableDevices.length > 0) {
      throw new HttpException({ message: 'Cannot update user. Some devices are not reachable', unreachableDevices }, HttpStatus.BAD_GATEWAY);
    }
    const results = [];
    for (let device of reachableDevices) {
      try {
        const result = await this.executeWithConnectionCheck(device.ip, async () => {
          const response = await client.get(
            `http://${device.ip}/cgi-bin/recordUpdater.cgi?action=update&name=AccessControlCard&recno=${device.recNo}&CardName=${name}`,
            { httpsAgent }
          );
          return { ip: device.ip, deviceName: device.name, recNo: device.recNo, result: response.data };
        }, 'updateUserOnDahua');
        if (result) results.push(result);
      } catch (error) {
        throw new HttpException(`Failed to update user on device ${device.name}: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }
    return results;
  }

  async deleteUser(param: DeleteUserFromMachineDto) {
    const { code } = param;
    const identificationRes = await axios.get(`${this.cloudUrl}/hr/identification?reference=${code}&description=Biometric Id`);
    const identification = identificationRes.data;
    if (!identification?.length) throw new HttpException('user not found on any device!', HttpStatus.NOT_FOUND);
    const deviceRecNoMap = {};
    const idRecordMap = {};
    identification.forEach(id => {
      if (id.remark) {
        const [recNo, deviceCode] = id.remark.split('/');
        deviceRecNoMap[deviceCode] = recNo;
        idRecordMap[deviceCode] = id;
      }
    });
    const userDeviceCodes = identification.map(e => e?.remark?.split('/')[1]);
    const deviceInfoRes = await axios.get(`${this.cloudUrl}/hr/device/code?code=${userDeviceCodes.join(',')}`);
    const deviceInfo = deviceInfoRes.data;
    const unreachableDevices = [];
    const reachableDevices = [];
    for (let device of deviceInfo) {
      const ip = device.ip;
      const isConnected = await this.checkDahuaConnection(ip);
      if (!isConnected) {
        unreachableDevices.push({ deviceName: device.name, ip, error: 'Device not reachable' });
      } else {
        reachableDevices.push({ ...device, recNo: deviceRecNoMap[device.code], idRecord: idRecordMap[device.code] });
      }
    }
    if (unreachableDevices.length > 0) {
      throw new HttpException({ message: 'Cannot delete user. Some devices are not reachable', unreachableDevices }, HttpStatus.BAD_GATEWAY);
    }
    const results = [];
    for (let device of reachableDevices) {
      try {
        const result = await this.executeWithConnectionCheck(device.ip, async () => {
          const response = await client.get(
            `http://${device.ip}/cgi-bin/recordUpdater.cgi?action=remove&name=AccessControlCard&recno=${device.recNo}`,
            { httpsAgent }
          );
          return { ip: device.ip, deviceName: device.name, recNo: device.recNo, result: response.data };
        }, 'deleteUserFromDahua');
        if (result) results.push(result);
      } catch (error) {
        unreachableDevices.push({ ip: device.ip, error: error.message });
      }
    }
    if (unreachableDevices.length > 0) {
      throw new HttpException({ message: 'Failed to delete user from some devices', unreachableDevices, successfulResults: results }, HttpStatus.PARTIAL_CONTENT);
    }
    await axios.delete(`${this.cloudUrl}/hr/identification?reference=${code}&type=LKUP000000525`);
    return results;
  }

  async getLogs() {
    const machines = await this.getHrMachineIPs();
    const final_result = [];
    const unreachableDevices = [];
    for (let machine of machines) {
      const lastTimeStamp = await axios.get(`${this.cloudUrl}/hr/sync/attendance/last-time?machineId=${machine.code}`);
      const time_stamp = lastTimeStamp?.data?.length ? this.sqlDatetimeToUnix(lastTimeStamp.data[0]?.timestamp) : null;
    
      const result = await this.executeWithConnectionCheck(machine.ip, async () => {
        let log_url = `http://${machine.ip}/cgi-bin/recordFinder.cgi?action=find&name=AccessControlCardRec`;
        if (time_stamp) log_url += `&StartTime=${time_stamp}`;
        const response = await client.get(log_url, { httpsAgent });
        const parsedResult = this.parseDahuaResponse(response.data);
        return parsedResult.map(record => ({ ...record, deviceIP: machine.ip }));
      }, 'getDahuaAccessLogs', false);
      if (result) {
        final_result.push(...result.map(e => ({ ...e, machineId: machine.code })));
      } else {
        unreachableDevices.push(machine.ip);
      }
    }
    return final_result;
  }

  sqlDatetimeToUnix(dt: string){
    return Math.floor((new Date(dt).getTime() / 1000) + 1);
  }


  parseDahuaResponse(text: string) {
    const lines = text.split('\r\n');
    const records = [];
    lines.forEach(line => {
      if (line.startsWith('records[')) {
        const match = line.match(/records\[(\d+)\]\.(.+)=(.+)/);
        if (match) {
          const [_, index, key, value] = match;
          if (!records[index]) records[index] = {};
          records[index][key] = value;
        }
      }
    });
    return records.filter(Boolean);
  }
} 