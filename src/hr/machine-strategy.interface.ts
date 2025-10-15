import { AddUserToMachineDto, UpdateUserOnMachineDto, DeleteUserFromMachineDto, GetMachineLogsDto } from './dtos/hr-machine.dto';

export interface AttendanceMachineStrategy {
  addUser(param: AddUserToMachineDto): Promise<any>;
  updateUser(param: UpdateUserOnMachineDto): Promise<any>;
  deleteUser(param: DeleteUserFromMachineDto): Promise<any>;
  getLogs(): Promise<any>;
} 