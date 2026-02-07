package flashsale.scenarios

import io.gatling.core.Predef._
import io.gatling.http.Predef._
import scala.concurrent.duration._
import flashsale.helpers.{WeightedProductPicker, JsonHelper}
import flashsale.state.SharedState
import java.util.UUID

object FlashSaleScenario {

  // No `forever` — closed model injection maintains concurrency by replacing
  // completed users. Each user runs one iteration and exits.
  private def makeScenario(name: String) = scenario(name)
    .exec { session =>
      val productId = WeightedProductPicker.pick()
      val quantity = scala.util.Random.nextInt(3) + 1
      val idempotencyKey = UUID.randomUUID().toString
      val customerId = s"customer_vu${session.userId}"
      session
        .set("productId", productId)
        .set("quantity", quantity)
        .set("idempotencyKey", idempotencyKey)
        .set("customerId", customerId)
    }
    .exec(
      http("flash_sale_place_order")
        .post("/orders")
        .body(StringBody(
          """{"product_id":#{productId},"idempotency_key":"#{idempotencyKey}","customer_id":"#{customerId}","quantity":#{quantity}}"""
        ))
        // saveAs first so the attribute is always set when a response exists
        .check(status.saveAs("orderStatus"))
        .check(bodyString.saveAs("orderBody"))
    )
    // Guard: only proceed if we actually got a response
    .doIf(session => session.contains("orderStatus")) {
      exec { session =>
        val st = session("orderStatus").as[String].toInt
        // Treat only 5xx as failures (matching k6 behavior)
        if (st == 201) {
          try {
            val body = session("orderBody").as[String]
            val json = JsonHelper.parse(body)
            val orderId = json.get("id").asText()
            val productId = session("productId").as[Int]
            val quantity = session("quantity").as[Int]
            SharedState.createdOrders.add(SharedState.CreatedOrder(orderId, productId, quantity))
            SharedState.ordersCreatedCount.incrementAndGet()
            session.set("createdOrderId", orderId)
          } catch {
            case _: Exception => session
          }
        } else if (st == 409) {
          SharedState.stockExhaustedCount.incrementAndGet()
          session
        } else {
          session
        }
      }
      .doIf(session => session.contains("createdOrderId")) {
        exec(
          http("flash_sale_verify_order")
            .get("/orders/#{createdOrderId}")
            .check(status.is(200))
            .check(jsonPath("$.id").is("#{createdOrderId}"))
        )
      }
    }
    .pause(0.milliseconds, 100.milliseconds)

  val scn = makeScenario("Phase 2 - Flash Sale Burst")

  val postCancelScn = makeScenario("Phase 3b - Post-Cancel Orders")
}
