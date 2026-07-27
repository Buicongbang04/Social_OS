import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { PasswordService, RefreshTokenService } from "@repo/auth";
import { AppConfig } from "../../config/app.config";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { TokenService } from "./token.service";

@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    JwtStrategy,
    {
      // argon2 cost is configurable so CI can run cheap without weakening
      // production, where the OWASP defaults apply.
      provide: PasswordService,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        new PasswordService({
          memoryCost: config.argon2MemoryCost,
          timeCost: config.argon2TimeCost,
        }),
    },
    {
      provide: RefreshTokenService,
      useFactory: () => new RefreshTokenService(),
    },
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
