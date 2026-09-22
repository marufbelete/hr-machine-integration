import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from '../http_client';

export type AttendanceLogPayload = {
  code: string;
  identification: string;
  machineId: string;
  timestamp: string;
  isSynchronized: number;
  remark: string;
  isBase?: boolean;
};

type SyncAttendanceResponse = {
  acceptedCount?: number;
  unknownIdentifications?: string[];
};

@Injectable()
export class CloudAttendanceService {
  constructor(private readonly configService: ConfigService) {}

  getCloudUrls(): string[] {
    const base = this.configService.get<string>('CLOUD_URL')?.trim();
    const extra = this.configService.get<string>('ADDITIONAL_CLOUD_URLS') || '';
    const extras = extra
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean);
    const urls = [...(base ? [base] : []), ...extras];
    return [...new Set(urls)];
  }

  /**
   * Posts a chunk to the base API first, then only unknown identifications
   * to each additional API until none remain or URLs are exhausted.
   * Throws on HTTP failure so the caller can stop the batch and retry later.
   */
  async syncLogsWaterfall(chunk: AttendanceLogPayload[]): Promise<AttendanceLogPayload[]> {
    const urls = this.getCloudUrls();
    if (!urls.length) {
      throw new Error('CLOUD_URL is not configured.');
    }

    let remaining = chunk;
    for (let i = 0; i < urls.length; i++) {
      if (!remaining.length) {
        break;
      }
      const url = urls[i];
      const isBase = i === 0;
      const { data } = await axios.request<SyncAttendanceResponse>({
        method: 'POST',
        url: `${url}/hr/sync/attendance`,
        data: remaining.map((row) => ({ ...row, isBase })),
        headers: {
          'Content-Type': 'application/json',
          'X-From-Sync': 'true',
        },
        validateStatus: (status) => status >= 200 && status < 300,
      });

      remaining = this.filterUnknown(remaining, data, url, isBase);
      const acceptedLabel =
        data?.acceptedCount !== undefined ? data.acceptedCount : 'n/a';
      console.log(
        `${isBase ? 'Base' : 'Additional'} ${url}: accepted ${acceptedLabel}, remaining unknown: ${remaining.length}`,
      );
    }

    return remaining;
  }

  /**
   * Latest stored punch across all org APIs, so Org B punches still advance
   * the machine read window when the base org never stored them.
   */
  async getLastAttendanceUnix(machineId: string): Promise<number | null> {
    const urls = this.getCloudUrls();
    if (!urls.length) {
      return null;
    }

    const timestamps: number[] = [];
    for (const url of urls) {
      try {
        const lastTimeStamp = await axios.get(
          `${url}/hr/sync/attendance/last-time?machineId=${machineId}`,
        );
        const raw = lastTimeStamp?.data?.[0]?.timestamp;
        if (!raw) {
          continue;
        }
        timestamps.push(this.sqlDatetimeToUnix(raw));
      } catch (error) {
        console.error(
          `Failed to read last attendance time from ${url}:`,
          error?.response?.data || error.message,
        );
      }
    }

    if (!timestamps.length) {
      return null;
    }
    return Math.max(...timestamps);
  }

  private filterUnknown(
    sent: AttendanceLogPayload[],
    data: SyncAttendanceResponse | undefined,
    url: string,
    isBase: boolean,
  ): AttendanceLogPayload[] {
    if (!data || !Array.isArray(data.unknownIdentifications)) {
      if (isBase && this.getCloudUrls().length > 1) {
        console.warn(
          `${url} did not return unknownIdentifications; treating the chunk as fully accepted. Additional org APIs will not receive these logs.`,
        );
      }
      return [];
    }

    const unknown = new Set(
      data.unknownIdentifications.map((id) => String(id)),
    );
    return sent.filter((row) => unknown.has(String(row.identification)));
  }

  private sqlDatetimeToUnix(dt: string) {
    return Math.floor(new Date(dt).getTime() / 1000 + 1);
  }
}
