import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { OpenAPIObject } from "@nestjs/swagger";

/**
 * The API, described.
 *
 * Built from the running application rather than written by hand, so the
 * document cannot describe an endpoint that no longer exists — the failure that
 * makes hand-written API docs worse than none.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("AI Social OS API")
    .setDescription(
      [
        "Mọi route đều cần đăng nhập trừ khi ghi rõ là công khai.",
        "Route thuộc phạm vi workspace cần thêm header `X-Workspace-Id`;",
        "thiếu nó là 400, và trỏ vào workspace không phải của mình là 404",
        "chứ không phải 403 — 403 sẽ xác nhận workspace đó có tồn tại.",
      ].join(" "),
    )
    .setVersion("1.0")
    .addBearerAuth(
      { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      "access-token",
    )
    .addGlobalParameters({
      name: "X-Workspace-Id",
      in: "header",
      required: false,
      description:
        "Workspace đang thao tác. Bắt buộc với route thuộc phạm vi workspace.",
      schema: { type: "string", example: "wsp_01H..." },
    })
    .build();

  return SwaggerModule.createDocument(app, config);
}
