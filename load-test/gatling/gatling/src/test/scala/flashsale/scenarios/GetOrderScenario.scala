package flashsale.scenarios

import io.gatling.core.Predef._
import io.gatling.http.Predef._
import scala.concurrent.duration._
import flashsale.helpers.JsonHelper
import flashsale.state.SharedState

object GetOrderScenario {

  val scn = scenario("Phase 3c - Get Order by ID")
    .exec { session =>
      val productId = scala.util.Random.nextInt(5) + 1
      session.set("getOrd_productId", productId)
    }
    .exec(
      http("get_order_list")
        .get("/orders?product_id=#{getOrd_productId}")
        .check(status.is(200))
        .check(bodyString.saveAs("getOrd_listBody"))
    )
    .exec { session =>
      try {
        val body = session("getOrd_listBody").as[String]
        val json = JsonHelper.parse(body)
        val orders = json.get("orders")

        if (orders.size() > 0) {
          val idx = scala.util.Random.nextInt(orders.size())
          val target = orders.get(idx)
          session
            .set("getOrd_targetOrderId", target.get("order_id").asText())
            .set("getOrd_expectedStatus", target.get("status").asText())
            .set("getOrd_expectedQuantity", target.get("quantity").asInt())
            .set("getOrd_hasTarget", true)
        } else {
          session.set("getOrd_hasTarget", false)
        }
      } catch {
        case _: Exception => session.set("getOrd_hasTarget", false)
      }
    }
    .doIf(session => session("getOrd_hasTarget").as[Boolean]) {
      exec(
        http("get_order_by_id")
          .get("/orders/#{getOrd_targetOrderId}")
          .check(status.is(200))
          .check(jsonPath("$.id").is("#{getOrd_targetOrderId}"))
          .check(jsonPath("$.idempotency_key").exists)
          .check(jsonPath("$.product_id").exists)
          .check(jsonPath("$.customer_id").exists)
          .check(jsonPath("$.quantity").exists)
          .check(jsonPath("$.unit_price").exists)
          .check(jsonPath("$.total_price").exists)
          .check(jsonPath("$.status").exists)  // Don't assert exact status — may change due to concurrent cancellations
          .check(jsonPath("$.created_at").exists)
      )
      .exec { session =>
        SharedState.getOrderSuccessCount.incrementAndGet()
        session
      }
    }
    .exec(
      http("get_order_404")
        .get("/orders/00000000-0000-4000-8000-000000000000")
        .check(status.is(404))
    )
    .exec(
      http("get_order_422")
        .get("/orders/not-a-valid-uuid")
        .check(status.is(422))
    )
    .pause(0.milliseconds, 300.milliseconds)
}
