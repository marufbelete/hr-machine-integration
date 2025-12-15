import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HrMachineService } from './hr-machine.service';
import cron from 'node-cron';
import axios from "../http_client";
import { HikvisionMachineService } from './hikvision-machine.service';

const jobRegistry = new Map();


@Injectable()
export class BotService implements OnApplicationBootstrap {
  private isCloudAttendanceJobRunning = false;
  private isCloudUserSyncJobRunning = false;
  private readonly machineType : string = "DAHUA";
  // private readonly machineType = 'HIKVISION';
  private readonly CLOUD_URL="https://app-api.nabusinessventures.com/api";
  // private readonly CLOUD_URL="https://lclassic-api.4loopes.com/api";
  // private readonly CLOUD_URL="http://localhost:5000/api";

  constructor(
    private readonly hrMachineService: HrMachineService,
    private readonly configService: ConfigService,
    private readonly hikvisionMachineService: HikvisionMachineService,
  ) {}

  onApplicationBootstrap() {
    this.cloudAttendanceLogJobBoot();
    if (this.machineType === 'HIKVISION') {
      this.syncHikvisionMachineTimeOnStartup();
    }
    this.cloudHrSyncJobBoot();
  }

  private async isOnline() {
    try {
      await axios.get('https://www.google.com', { timeout: 6000 });
      return true;
    } catch (error) {
      return false;
    }
  }

  private createCronJob(schedule: string, task: () => Promise<void>, jobId = 'jobId Cron Job', runOnce = false, options = {}) {
    if (!cron.validate(schedule)) {
      throw new Error(`Invalid cron schedule: ${schedule}`);
    }
    console.log(`[${jobId}] Cron job scheduled: ${schedule}`);
    const job = cron.schedule(schedule, async () => {
      console.log(`[${jobId}] Running task...`);
      try {
        await task();
      } catch (error) {
        console.error(`[${jobId}] Error executing task:`, error);
      } finally {
        if (runOnce) {
          job.stop();
          console.log(`[${jobId}] Cron job stopped (runOnce enabled).`);
          jobRegistry.delete(jobId);
        }
      }
    }, options);
    jobRegistry.set(jobId, job);
    return job;
  }

  private cloudAttendanceLogJobBoot() {
    this.createCronJob(
      '*/1 * * * *',
      async () => {
        if (this.isCloudAttendanceJobRunning) {
          console.log('Previous cloud attendance job still running, skipping this run.');
          return;
        }
        this.isCloudAttendanceJobRunning = true;
        const online = await this.isOnline();
        if (!online) {
          console.log('🚫 Internet not available. Skipping attendance cloud log .');
          this.isCloudAttendanceJobRunning = false;
          return;
        }
        try { 
          const logs = await this.hrMachineService.getMachineLogs(this.machineType);
          if (!logs?.length) return;
          for (const log of logs) {
            try {
              if (log?.UserID && log?.Status && log?.Status!='undefined') {
                const payload = {
                  code: '',
                  identification: log?.UserID,
                  machineId: log?.machineId,
                  timestamp: log.CreateTime,
                  isSynchronized: 0,
                  remark: log?.URL,
                };

                await axios.request({
                  method: 'POST',
                  url: `${this.CLOUD_URL}/hr/sync/attendance`,
                  data: payload,
                  headers: {
                    'Content-Type': 'application/json',
                    'X-From-Sync': 'true',
                  },
                  validateStatus: (status) => status >= 200 && status < 300,
                });
              }
              // add to sync table if needed
            } catch (error) {
              console.error(`Error processing attendance outer log ${log.UserID}:`, error);
              break;
            }
          }
        } catch (error) {
          console.error('Error processing attendance log:', error);
        } finally {
          this.isCloudAttendanceJobRunning = false;
        }
      },
      'ATTENDANCE_LOG',
      false,
      { scheduled: true, timezone: 'Africa/Nairobi' }
    );
  }

  private cloudHrSyncJobBoot() {
    this.createCronJob(
      '*/1 * * * *',
      async () => {
        await this.syncCloudUsers();
      },
      'CLOUD_HR_SYNC',
      false,
      { scheduled: true, timezone: 'Africa/Nairobi' },
    );
  }

  private async syncCloudUsers() {
    if (this.isCloudUserSyncJobRunning) {
      console.log('Previous cloud user sync job still running, skipping this run.');
      return;
    }
    this.isCloudUserSyncJobRunning = true;
    const online = await this.isOnline();
    if (!online) {
      console.log('🚫 Internet not available. Skipping cloud user sync.');
      this.isCloudUserSyncJobRunning = false;
      return;
    }

    try {
      if (!this.CLOUD_URL) {
        console.error('CLOUD_API_URL is not configured.');
        return;
      }
      const devices = await axios.get(`${this.CLOUD_URL}/hr/device?preference=PREFE000000057`);
      //for each device
      for(let device of devices.data){
        const syncData = await axios.get(`${this.CLOUD_URL}/sync?metadata=Hr Pending&&branch=${device.code}`, {
          headers: {
            'X-From-Sync': 'true',
          },
        });
         // Assuming data is nested under 'data'
  
        if (!syncData.data || !syncData.data.length) {
          continue;
        }
  console.log(syncData.data)
  console.log('syncData.data')
        for (const syn of syncData.data) {
          const payloadData = JSON.parse(syn.payload);
          try {
            const machineType = this.machineType; // Use user's machineType or default
            const action = syn.method;
            const payload={userId:syn.unique_code,name:`${payloadData?.firstName} ${payloadData?.lastName || ' '} ${payloadData?.lastName || ' '}  `,
            identification:syn.unique_code,startDate:'2025-10-10', endDate:'2035-10-10', devices: [{name:"Device X",code:syn.branch}]
            }
            console.log(payload)
            console.log(action)
            console.log(machineType)
            switch (action) {
              case 'POST':
                await this.hrMachineService.addUserToMachine(payload, machineType);
                console.log(`User ${payload.userId} added to machineType ${machineType}`);
                break;
              case 'PUT':
                await this.hrMachineService.updateUserOnMachine(payload, machineType);
                console.log(`User ${payload} updated on machineType ${machineType}`);
                break;
              case 'DELETE':
                await this.hrMachineService.deleteUserFromMachine(payload.userId, machineType);
                console.log(`User ${payload} deleted from machineType ${machineType}`);
                break;
              default:
                console.warn(`Unknown action ${action} for user ${payload.userId}`);
            }
  
            // Optionally, send a confirmation back to the cloud API
            await axios.put(`${this.CLOUD_URL}/sync/metadata`, { code:payload.userId,metadata:"Hr Completed" }, {
              headers: {
                'X-From-Sync': 'true',
              },
            });
  
          } catch (error) {
            console.log(error)
            console.log('in hereerror')
            await axios.put(`${this.CLOUD_URL}/sync`,{
              code: syn.id,
              error: JSON.stringify(error?.response?.message || 'Unknown error')
          }, {
            headers: {
              'X-From-Sync': 'true',
            },
          });
            console.error(`Error processing cloud data:`, error);
          }
        }
      }

    } catch (error) {
      console.error('Error syncing cloud users:', error);
    } finally {
      this.isCloudUserSyncJobRunning = false;
    }
  }
//end
  private async syncHikvisionMachineTimeOnStartup() {
    try {
      const machineIPs = await this.hikvisionMachineService.getHrMachineIPs();
      for (const machine of machineIPs) {
        console.log(`Attempting to set time for Hikvision machine at IP: ${machine.ip}`);
        await this.hikvisionMachineService.setMachineTime(machine.ip);
      }
      console.log('Hikvision machine time synchronization completed.');
    } catch (error) {
      console.error('Error during Hikvision machine time synchronization:', error.message);
    }
  }
} 