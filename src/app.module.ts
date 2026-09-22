import { Module } from "@nestjs/common";
import { HrModule } from "./hr/hr.module";
import { ConfigModule } from "@nestjs/config";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HrModule,
  ],
})
export class AppModule {
  constructor() {}
}
