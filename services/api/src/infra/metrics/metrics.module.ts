import { Global, Module } from "@nestjs/common";
import { Metrics } from "@repo/observability";
import { MetricsController } from "./metrics.controller";

/**
 * Metrics, and the endpoint a scraper reads them from.
 *
 * One `Metrics` for the process, injected rather than reached for globally, so
 * a test can build its own and two suites cannot leave counters on each other.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    {
      provide: Metrics,
      useFactory: () => new Metrics(),
    },
  ],
  exports: [Metrics],
})
export class MetricsModule {}
