package flashsale.scenarios

import io.gatling.core.Predef._
import io.gatling.http.Predef._
import scala.concurrent.duration._
import flashsale.helpers.JsonHelper
import flashsale.state.SharedState

object CancelWaveScenario {

  val scn = scenario("Phase 3 - Cancellation Wave")
    .exec { session =>
      val productId = scala.util.Random.nextInt(5) + 1
      session.set("cancel_productId", productId)
    }
    .exec(
      http("cancel_list_orders")
        .get("/orders?product_id=#{cancel_productId}")
        .check(status.is(200))
        .check(bodyString.saveAs("cancel_listBody"))
    )
    .exec { session =>
      try {
        val body = session("cancel_listBody").as[String]
        val json = JsonHelper.parse(body)
        val orders = json.get("orders")
        val confirmed = (0 until orders.size())
          .map(i => orders.get(i))
          .filter(o => o.get("status").asText() == "CONFIRMED")
          .toSeq

        if (confirmed.nonEmpty) {
          val target = confirmed(scala.util.Random.nextInt(confirmed.size))
          session
            .set("cancel_targetOrderId", target.get("order_id").asText())
            .set("cancel_hasTarget", true)
        } else {
          session.set("cancel_hasTarget", false)
        }
      } catch {
        case _: Exception => session.set("cancel_hasTarget", false)
      }
    }
    .doIf(session => session("cancel_hasTarget").as[Boolean]) {
      exec(
        http("cancel_order")
          .post("/orders/#{cancel_targetOrderId}/cancel")
          .check(status.in(200, 409, 404))
          .check(status.saveAs("cancel_status"))
      )
      .exec { session =>
        val st = session("cancel_status").as[String].toInt
        if (st == 200) SharedState.ordersCancelledCount.incrementAndGet()
        else if (st == 409) SharedState.cancelAlreadyCancelledCount.incrementAndGet()
        session
      }
    }
    .pause(0.milliseconds, 300.milliseconds)
}
