package flashsale.scenarios

import io.gatling.core.Predef._
import io.gatling.http.Predef._
import scala.concurrent.duration._
import flashsale.helpers.JsonHelper
import flashsale.state.SharedState
import java.util.UUID

object IdempotencyScenario {

  // Each user does a complete idempotency test in one pass:
  // 1. Place original order
  // 2. Replay same request 3 times and verify idempotent behavior
  val scn = scenario("Phase 2b - Idempotency Retries")
    .exec { session =>
      val productId = (session.userId % 5).toInt + 1
      val key = UUID.randomUUID().toString
      val customerId = s"idem_vu${session.userId}"
      session
        .set("idem_productId", productId)
        .set("idem_key", key)
        .set("idem_customerId", customerId)
        .set("idem_quantity", 1)
    }
    // Step 1: Place original order
    .exec(
      http("idempotency_original")
        .post("/orders")
        .body(StringBody(
          """{"product_id":#{idem_productId},"idempotency_key":"#{idem_key}","customer_id":"#{idem_customerId}","quantity":#{idem_quantity}}"""
        ))
        .check(status.saveAs("idem_originalStatus"))
        .check(bodyString.saveAs("idem_originalBody"))
    )
    // Parse result — guard against missing attributes from connection errors
    .doIf(session => session.contains("idem_originalStatus")) {
      exec { session =>
        val st = session("idem_originalStatus").as[String].toInt
        if (st == 201) {
          try {
            val json = JsonHelper.parse(session("idem_originalBody").as[String])
            val orderId = json.get("id").asText()
            session
              .set("idem_originalCreated", true)
              .set("idem_orderId", orderId)
          } catch {
            case _: Exception => session.set("idem_originalCreated", false)
          }
        } else {
          session.set("idem_originalCreated", false)
        }
      }
    }
    // Step 2: Replay 3 times
    .repeat(3) {
      // Replay when original succeeded → expect 200 with same order_id
      doIf(session => session.contains("idem_originalCreated") && session("idem_originalCreated").as[Boolean]) {
        exec(
          http("idempotency_replay_success")
            .post("/orders")
            .body(StringBody(
              """{"product_id":#{idem_productId},"idempotency_key":"#{idem_key}","customer_id":"#{idem_customerId}","quantity":#{idem_quantity}}"""
            ))
            .check(status.is(200))
            .check(jsonPath("$.id").is("#{idem_orderId}"))
        )
        .exec { session =>
          SharedState.idempotentReplaysCorrectCount.incrementAndGet()
          session
        }
        .pause(200.milliseconds, 500.milliseconds)
      }
      // Replay when original failed → expect NOT 201
      .doIf(session => session.contains("idem_originalCreated") && !session("idem_originalCreated").as[Boolean]) {
        exec(
          http("idempotency_replay_failed")
            .post("/orders")
            .body(StringBody(
              """{"product_id":#{idem_productId},"idempotency_key":"#{idem_key}","customer_id":"#{idem_customerId}","quantity":#{idem_quantity}}"""
            ))
            .check(status.in(200, 409, 422))
        )
        .pause(200.milliseconds, 500.milliseconds)
      }
    }
    .pause(300.milliseconds, 600.milliseconds)
}
