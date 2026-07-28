import { Module } from "@nestjs/common";
import { SecretsModule } from "../secrets/secrets.module";
import { ConnectionsController } from "./connections.controller";
import { ConnectionsService } from "./connections.service";
import { PendingAuthorizations } from "./pending-authorizations";

@Module({
  // The tokens this flow produces go into the vault, so the two are not
  // separable: a connection without somewhere to seal its credentials is a
  // connection that would have to keep them in a row.
  imports: [SecretsModule],
  controllers: [ConnectionsController],
  providers: [ConnectionsService, PendingAuthorizations],
  exports: [ConnectionsService],
})
export class ConnectionsModule {}
