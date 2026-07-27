import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { AppConfigModule } from "../../config/config.module";
import { AppConfig } from "../../config/app.config";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";

@Module({
  imports: [
    MulterModule.registerAsync({
      imports: [AppConfigModule],
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        // In memory, so the file never touches this machine's disk — the API
        // may be several replicas behind a load balancer, and a temp file
        // written by one of them is not there for the next request.
        storage: undefined,
        // The cap that actually protects the process. The service checks the
        // size too, but by then the bytes are already buffered; this refuses
        // them mid-stream, which is the point of having a limit at all.
        limits: { fileSize: config.uploadMaxBytes, files: 1 },
      }),
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
