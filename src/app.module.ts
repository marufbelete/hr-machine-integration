import { Module } from "@nestjs/common";
import { HrModule } from "./hr/hr.module";
import { ConfigModule } from "@nestjs/config";
import * as path from "path";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.join(process.cwd(), ".env"),
        path.join(path.dirname(process.execPath), ".env"),
      ],
    }),
    HrModule,
  ],
})
export class AppModule {
  constructor() {}
}
