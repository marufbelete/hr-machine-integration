export interface DeviceInfo {
  code: string;
  name: string;
  ip: string;
}

export interface IdentificationRecord {
  remark?: string;
  idNumber?: string;
  reference?: string;
  [key: string]: any;
}

export interface DahuaLogRecord {
  UserID: string;
  CreateTime: string;
  URL?: string;
  machineId?: string;
  [key: string]: any;
} 