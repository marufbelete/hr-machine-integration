import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as dayjs from 'dayjs';
import { AttendanceMachineStrategy } from './machine-strategy.interface';
import { AddUserToMachineDto, UpdateUserOnMachineDto, DeleteUserFromMachineDto, GetMachineLogsDto } from './dtos/hr-machine.dto';
import axios from "../http_client";
import axiosDigest from 'axios-digest';
import * as https from 'https';
import { parseStringPromise } from 'xml2js';

const client = new axiosDigest('admin', 'Ela@12345');
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

@Injectable()
export class HikvisionMachineService implements AttendanceMachineStrategy {
  
  private get cloudUrl(): string {
    return this.configService.get<string>('CLOUD_URL');
  }
  constructor(private readonly configService: ConfigService) {
  }

  async getHrMachineIPs() {
    const res = await axios.get(`${this.cloudUrl}/hr/device?preference=PREFE000000057`);
    return res.data;
  }

  async checkHikvisionConnection(ip: string, timeout = 5000): Promise<boolean> {
    try {
      const response = await client.get(
        `http://${ip}/ISAPI/System/deviceInfo`,
        { httpsAgent, timeout }
      );
      
      const parsed = await parseStringPromise(response.data);
      return !!parsed?.DeviceInfo?.deviceName;
    } catch (error) {
      console.log(error)
      return false;
    }
  }

  async executeWithConnectionCheck<T>(ip: string, operation: () => Promise<T>, operationName: string, throwError = true): Promise<T | null> {
    const isConnected = await this.checkHikvisionConnection(ip);
    const ips = await this.getHrMachineIPs();
    const deviceInfo = ips.find(e => e.ip === ip);
    const deviceName = deviceInfo ? deviceInfo.name : ip;
    if (!isConnected) {
      if (throwError) {
        throw new HttpException(`Hikvision device at ${deviceName} is not reachable. Cannot execute ${operationName}`, HttpStatus.BAD_GATEWAY);
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
    for (let device of devices) {
      const deviceInfoRes = await axios.get(`${this.cloudUrl}/hr/device/code?code=${device.code}`);
      const [device_info] = deviceInfoRes.data;
      param['ip'] = device_info.ip;
      
      const isConnected = await this.checkHikvisionConnection(param['ip']);
      if (!isConnected) {
        unreachableDevices.push({ deviceName: device.name, ip: param['ip'], error: 'Device not reachable' });
      } else {
        reachableDevices.push(device);
      }
    }
    if (unreachableDevices.length > 0) {
      throw new HttpException({ message: 'Cannot add user. Some devices are not reachable', unreachableDevices }, HttpStatus.BAD_GATEWAY);
    }

    const results = [];
    for (let device of reachableDevices) {
      try {
        const result = await this.executeWithConnectionCheck(param['ip'], async () => {
          const response = await client.post(
            `http://${param['ip']}/ISAPI/AccessControl/UserInfo/Record?format=json`,
            {
              UserInfo: {
                employeeNo: this.sanitizeIdentification(identification),
                name,
                userType: "normal",
                gender: "male",
                Valid: {
                  enable: true,
                  beginTime: `${startDate}T00:00:00+03:00`,
                  endTime: `${endDate}T23:59:59+03:00`,
                  timeType: "local"
                },
                doorRight: "1",
                RightPlan: [{ doorNo: 1, planTemplateNo: "1" }]
              }
            },
            { httpsAgent }
          );
          return { status: response.data.statusString || "OK", deviceCode: device.code, deviceName: device.name };
        }, 'addUserToHikvision');

        if (result) {
          results.push({
            description: "Biometric Id",
            type: 'LKUP000000525',
            Index: 0,
            idNumber: this.sanitizeIdentification(identification),
            issueDate: startDate,
            expiryDate: endDate,
            reference: userId,
            remark: result.status
          });
        }
      } catch (error) {
        throw new HttpException(`Failed to save user on device ${device.name}: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }

    await axios.post(`${this.cloudUrl}/hr/identification`, results);
    return results;
  }

  async updateUser(param: UpdateUserOnMachineDto) {
    const { userId, name } = param;
    const identificationRes = await axios.get(`${this.cloudUrl}/hr/identification?reference=${userId}`);
    const identification = identificationRes.data;
    if (!identification?.length) return { message: 'user not found on device' };

    const deviceMap = {};
    identification.forEach(id => {
      if (id.remark) {
        const [status, deviceCode] = id.remark.split('/');
        deviceMap[deviceCode] = status;
      }
    });

    const userDeviceCodes = identification.map(e => e?.remark?.split('/')[1]);
    const deviceInfoRes = await axios.get(`${this.cloudUrl}/hr/device/code?code=${userDeviceCodes.join(',')}`);
    const deviceInfo = deviceInfoRes.data;

    const unreachableDevices = [];
    const reachableDevices = [];
    for (let device of deviceInfo) {
      const ip = device.ip;
      const isConnected = await this.checkHikvisionConnection(ip);
      if (!isConnected) {
        unreachableDevices.push({ deviceName: device.name, ip, error: 'Device not reachable' });
      } else {
        reachableDevices.push(device);
      }
    }
    if (unreachableDevices.length > 0) {
      throw new HttpException({ message: 'Cannot update user. Some devices are not reachable', unreachableDevices }, HttpStatus.BAD_GATEWAY);
    }

    const results = [];
    for (let device of reachableDevices) {
      try {
        const result = await this.executeWithConnectionCheck(device.ip, async () => {
          const response = await client.put(
            `http://${device.ip}/ISAPI/AccessControl/UserInfo/Modify?format=json`,
            {
              UserInfo: {
                employeeNo: userId,
                name
              }
            },
            { httpsAgent }
          );
          return { ip: device.ip, deviceName: device.name, result: response.data };
        }, 'updateUserOnHikvision');

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

    const userDeviceCodes = identification.map(e => e?.remark?.split('/')[1]);
    const deviceInfoRes = await axios.get(`${this.cloudUrl}/hr/device/code?code=${userDeviceCodes.join(',')}`);
    const deviceInfo = deviceInfoRes.data;

    const unreachableDevices = [];
    const reachableDevices = [];
    for (let device of deviceInfo) {
      const ip = device.ip;
      const isConnected = await this.checkHikvisionConnection(ip);
      if (!isConnected) {
        unreachableDevices.push({ deviceName: device.name, ip, error: 'Device not reachable' });
      } else {
        reachableDevices.push(device);
      }
    }
    if (unreachableDevices.length > 0) {
      throw new HttpException({ message: 'Cannot delete user. Some devices are not reachable', unreachableDevices }, HttpStatus.BAD_GATEWAY);
    }

    const results = [];
    for (let device of reachableDevices) {
      try {
        const result = await this.executeWithConnectionCheck(device.ip, async () => {
          const response = await client.delete(
            `http://${device.ip}/ISAPI/AccessControl/UserInfo/Delete?format=json`,
            {
              data: { UserInfo: { employeeNo: code } },
              httpsAgent
            }
          );
          return { ip: device.ip, deviceName: device.name, result: response.data };
        }, 'deleteUserFromHikvision');

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
      try {
        console.log(this.cloudUrl)
        const lastTimeStamp = await axios.get(`${this.cloudUrl}/hr/sync/attendance/last-time?machineId=${machine.code}`);
        const time_stamp = lastTimeStamp?.data?.length ? this.sqlDatetimeToUnix(lastTimeStamp.data[0]?.timestamp) : null;
        // 1. Convert timestamp -> Hikvision datetime format
        //2025-11-11T11:22:13.000Z
        const last_time_gmt3 = time_stamp
        ? await this.formatUnixToGMT3(Number(time_stamp)): null;

        const startTime = last_time_gmt3 ?? '2025-01-01T00:00:00+03:00';
        const endTime = dayjs().format('YYYY-MM-DDTHH:mm:ssZ');
      // 2. Now time as endTime

        let position = 0;
        let hasMore = true;
  
        while (hasMore) {
          const response = await this.executeWithConnectionCheck(
            machine.ip,
            async () => {
              console.log({
                searchID:"59999999",
                searchResultPosition: position,
                maxResults: 24, // request up to 50, device may cap to 10
                major: 5,
                minor: 0,
                startTime,
                endTime,
              })
              const res = await client.post(
                `http://${machine.ip}/ISAPI/AccessControl/AcsEvent?format=json`,
                {
                  AcsEventCond: {
                    searchID:"59999999",
                    searchResultPosition: position,
                    maxResults: 24, // request up to 50, device may cap to 10
                    major: 5,
                    minor: 0,
                    startTime,
                    endTime,
                  },
                },
                { httpsAgent }
              );
              return res.data.AcsEvent;
            },
            'getHikvisionLogs',
            false
          );
  
          if (!response) {
            unreachableDevices.push(machine.ip);
            break;
          }
  
          const infoList = response.InfoList || [];
          final_result.push(
            ...infoList.map((e) => ({
              UserID: e.employeeNoString,
              Status: e.attendanceStatus,
              CreateTime: e.time,
              machineId: machine.code,
              deviceIP: machine.ip,
            }))
          );
  
          position += infoList.length;
  
          // stop when we’ve reached all matches
          if (
            position >= (response.totalMatches ?? 0) ||
            response.responseStatusStrg === 'OK'
          ) {
            hasMore = false;
          }
        }
      } catch (err) {
        console.log(err)
        unreachableDevices.push(machine.ip);
        console.error(`Error fetching logs from ${machine.ip}:`, err.message);
      }
    }
    console.log('final_result')
    console.log(final_result)
  
    return final_result;
  }

  sqlDatetimeToUnix(dt: string){
    return Math.floor((new Date(dt).getTime() / 1000) + 1);
  }

  sanitizeIdentification(id: string): string {
    return id.replace(/[^a-zA-Z0-9]/g, '');
  }

  async formatUnixToGMT3(unixTimestamp: number){
    return dayjs
      .unix(unixTimestamp)     // convert unix → dayjs          // shift manually to GMT+3
      .format('YYYY-MM-DDTHH:mm:ss[+03:00]');
  }
  
  async setMachineTime(ip: string): Promise<any> {
    const xmlPayload = `<Time version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><timeMode>NTP</timeMode><NTPServer>pool.ntp.org</NTPServer><timeZone>CST-3:00:00D001</timeZone></Time>`;
    try {
      const response = await client.put(
        `http://${ip}/ISAPI/System/time`,
        xmlPayload,
        { headers: { 'Content-Type': 'application/xml' }, httpsAgent }
      );
      console.log(`Time synchronization successful for ${ip}:`, response.data);
      return response.data;
    } catch (error) {
      console.error(`Failed to set machine time for ${ip}:`, error.message);
      throw new HttpException(`Failed to set machine time for ${ip}: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}