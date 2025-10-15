import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HrMachineService } from './hr-machine.service';
import cron from 'node-cron';
import axios from "../http_client";

const jobRegistry = new Map();


@Injectable()
export class BotService implements OnApplicationBootstrap {
  private isCloudAttendanceJobRunning = false;

  constructor(
    private readonly hrMachineService: HrMachineService,
    private readonly configService: ConfigService,
  ) {}

  onApplicationBootstrap() {
    this.cloudAttendanceLogJobBoot();
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
          const machineType = "DAHUA";
          // const machineType = "HIKVISION";
          // const CLOUD_URL = "https://app-api.decentgroups.com/api";
          // const CLOUD_URL = "http://localhost:5000/api";
          const CLOUD_URL = "https://na-api.4loopes.com/api";
          
          const logs = await this.hrMachineService.getMachineLogs(machineType);
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
                  url: `${CLOUD_URL}/hr/sync/attendance`,
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
} 