package flashsale.scenarios

import io.gatling.core.Predef._
import io.gatling.http.Predef._
import scala.concurrent.duration._

object WarmupScenario {

  val scn = scenario("Phase 1 - Warmup")
    .during(10.seconds) {
      foreach(Seq(1, 2, 3, 4, 5), "productId") {
        exec(
          http("warmup_get_product")
            .get("/products/#{productId}")
            .check(status.is(200))
            .check(jsonPath("$.stock").exists)
        )
      }
      .pause(2.seconds)
    }
}
