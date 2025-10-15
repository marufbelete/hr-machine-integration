import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';


class DeviceDto {
  @IsString()
  code: string;

  @IsString()
  name: string;
}
export class AddUserToMachineDto {
  @IsString()
  userId: string;
  @IsString()
  name: string;
  @IsString()
  identification: string;
  @IsOptional()
  @IsString()
  startDate?: string;
  @IsOptional()
  @IsString()
  endDate?: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeviceDto)
  devices: DeviceDto[];
}

export class UpdateUserOnMachineDto {
  @IsString()
  userId: string;
  @IsString()
  name: string;
}

export class DeleteUserFromMachineDto {
  @IsString()
  code: string;
}

export class GetMachineLogsDto {
  timeStamp?: string;
} 

export class EmployeeCodeDto {
  @IsString()
  employeeCode?: string;
} 