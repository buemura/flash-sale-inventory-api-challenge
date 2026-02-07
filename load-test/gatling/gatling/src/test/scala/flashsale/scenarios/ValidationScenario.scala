package flashsale.scenarios

import io.gatling.core.Predef._
import io.gatling.http.Predef._
import scala.concurrent.duration._
import flashsale.config.TestConfig
import flashsale.helpers.JsonHelper
import flashsale.state.SharedState

object ValidationScenario {

  private def log(msg: String): Unit = println(s"[validation] $msg")

  val scn = scenario("Phase 4 - Validation")
    .pause(125.seconds)
    .exec { session =>
      log("=== Starting post-test validation ===")
      log(s"Custom counters:")
      log(s"  orders_created:             ${SharedState.ordersCreatedCount.get()}")
      log(s"  stock_exhausted:            ${SharedState.stockExhaustedCount.get()}")
      log(s"  orders_cancelled:           ${SharedState.ordersCancelledCount.get()}")
      log(s"  cancel_already_cancelled:   ${SharedState.cancelAlreadyCancelledCount.get()}")
      log(s"  idempotent_replays_correct: ${SharedState.idempotentReplaysCorrectCount.get()}")
      log(s"  get_order_success:          ${SharedState.getOrderSuccessCount.get()}")
      session
        .set("allOrderIds", Seq.empty[(String, Int)])
        .set("allIdempotencyKeys", Seq.empty[(String, Int)])
        .set("validationFailed", false)
    }
    // Iterate over all 5 products
    .foreach(Seq(1, 2, 3, 4, 5), "valProductId") {
      // Fetch current product state
      exec(
        http("validation_get_product")
          .get("/products/#{valProductId}")
          .check(status.is(200))
          .check(bodyString.saveAs("valProductBody"))
      )
      // Fetch orders for this product
      .exec(
        http("validation_get_orders")
          .get("/orders?product_id=#{valProductId}")
          .check(status.is(200))
          .check(bodyString.saveAs("valOrdersBody"))
      )
      .exec { session =>
        val productId = session("valProductId").as[Int]
        val product = TestConfig.products.find(_.id == productId).get

        val prodJson = JsonHelper.parse(session("valProductBody").as[String])
        val currentStock = prodJson.get("stock").asInt()

        val ordersJson = JsonHelper.parse(session("valOrdersBody").as[String])
        val orders = ordersJson.get("orders")
        val orderCount = orders.size()

        log(s"--- Product $productId: ${product.name} ---")
        log(s"  initial_stock=${product.initialStock}  stock=$currentStock")

        // Categorize orders
        var confirmedQty = 0
        var cancelledQty = 0
        var confirmedCount = 0
        var cancelledCount = 0
        val orderIds = scala.collection.mutable.ListBuffer.empty[String]
        val idempotencyKeys = scala.collection.mutable.ListBuffer.empty[String]
        val cancelledOrderIds = scala.collection.mutable.ListBuffer.empty[String]
        val orderDetails = scala.collection.mutable.ListBuffer.empty[(String, String, Int)]

        for (i <- 0 until orderCount) {
          val order = orders.get(i)
          val orderId = order.get("order_id").asText()
          val status = order.get("status").asText()
          val quantity = order.get("quantity").asInt()

          orderIds += orderId
          orderDetails += ((orderId, status, quantity))

          if (status == "CONFIRMED") {
            confirmedQty += quantity
            confirmedCount += 1
          } else if (status == "CANCELLED") {
            cancelledQty += quantity
            cancelledCount += 1
            cancelledOrderIds += orderId
          }
        }

        log(s"  orders: $orderCount total, $confirmedCount confirmed (qty=$confirmedQty), $cancelledCount cancelled (qty=$cancelledQty)")

        var failed = session("validationFailed").as[Boolean]

        // ---------------------------------------------------------------
        // Rule 1: Stock >= 0
        // ---------------------------------------------------------------
        if (currentStock < 0) {
          log(s"  FAIL: product $productId: stock < 0 ($currentStock)")
          failed = true
        }

        // Rule 1 (cont): Stock integrity equation
        if (orderCount < 50) {
          val expectedStock = product.initialStock - confirmedQty + cancelledQty
          if (currentStock != expectedStock) {
            log(s"  FAIL: product $productId: stock integrity (expected=$expectedStock, actual=$currentStock)")
            failed = true
          } else {
            log(s"  PASS: stock integrity (expected=$expectedStock, actual=$currentStock)")
          }
        } else {
          log(s"  WARNING: $orderCount orders returned (endpoint limit 50). Full stock equation cannot be verified.")
        }

        // ---------------------------------------------------------------
        // Rule 2: No duplicate order IDs within this product
        // ---------------------------------------------------------------
        val uniqueIds = orderIds.toSet
        if (orderIds.size != uniqueIds.size) {
          log(s"  FAIL: product $productId: duplicate order_ids (${orderIds.size} orders, ${uniqueIds.size} unique)")
          failed = true
        } else {
          log(s"  PASS: no duplicate order_ids (${orderIds.size} orders)")
        }

        // ---------------------------------------------------------------
        // Rule 4: Order consistency — stock delta matches order impact
        // ---------------------------------------------------------------
        if (orderCount < 50) {
          val stockDelta = product.initialStock - currentStock
          val orderImpact = confirmedQty - cancelledQty
          if (stockDelta != orderImpact) {
            log(s"  FAIL: product $productId: order consistency (delta=$stockDelta, impact=$orderImpact)")
            failed = true
          } else {
            log(s"  PASS: order consistency (delta=$stockDelta, impact=$orderImpact)")
          }
        }

        // Collect for cross-product checks
        val allOrderIds = session("allOrderIds").as[Seq[(String, Int)]] ++ orderIds.map(id => (id, productId))
        val allIdempotencyKeys = session("allIdempotencyKeys").as[Seq[(String, Int)]]

        session
          .set("allOrderIds", allOrderIds)
          .set("allIdempotencyKeys", allIdempotencyKeys)
          .set("validationFailed", failed)
          .set("valOrderDetails", orderDetails.toSeq)
          .set("valCancelledOrderIds", cancelledOrderIds.toSeq)
          .set("valCurrentStock", currentStock)
      }
      // ---------------------------------------------------------------
      // Rule 3: Fetch individual orders for idempotency_key uniqueness
      //         + field validation
      // ---------------------------------------------------------------
      .exec { session =>
        val orderDetails = session("valOrderDetails").as[Seq[(String, String, Int)]]
        val productId = session("valProductId").as[Int]
        session
          .set("valOrderIndex", 0)
          .set("valOrderTotal", orderDetails.size)
          .set("valCollectedKeys", Seq.empty[String])
      }
      .asLongAs(session => session("valOrderIndex").as[Int] < session("valOrderTotal").as[Int]) {
        exec { session =>
          val idx = session("valOrderIndex").as[Int]
          val orderDetails = session("valOrderDetails").as[Seq[(String, String, Int)]]
          val (orderId, expectedStatus, expectedQuantity) = orderDetails(idx)
          session
            .set("valCurrentOrderId", orderId)
            .set("valExpectedStatus", expectedStatus)
            .set("valExpectedQuantity", expectedQuantity)
        }
        .exec(
          http("validation_get_order_detail")
            .get("/orders/#{valCurrentOrderId}")
            .check(status.is(200))
            .check(bodyString.saveAs("valOrderDetailBody"))
        )
        .exec { session =>
          val productId = session("valProductId").as[Int]
          val orderId = session("valCurrentOrderId").as[String]
          val expectedStatus = session("valExpectedStatus").as[String]
          val expectedQuantity = session("valExpectedQuantity").as[Int]

          var failed = session("validationFailed").as[Boolean]
          var collectedKeys = session("valCollectedKeys").as[Seq[String]]

          try {
            val detail = JsonHelper.parse(session("valOrderDetailBody").as[String])

            // Validate required fields
            val hasAllFields =
              detail.has("id") && detail.has("idempotency_key") &&
              detail.has("product_id") && detail.has("customer_id") &&
              detail.has("quantity") && detail.has("unit_price") &&
              detail.has("total_price") && detail.has("status") &&
              detail.has("created_at")

            if (!hasAllFields) {
              log(s"  FAIL: product $productId: order $orderId missing required fields")
              failed = true
            }

            // Validate field values match list data
            if (detail.get("status").asText() != expectedStatus) {
              log(s"  FAIL: product $productId: order $orderId status mismatch (expected=$expectedStatus, actual=${detail.get("status").asText()})")
              failed = true
            }
            if (detail.get("quantity").asInt() != expectedQuantity) {
              log(s"  FAIL: product $productId: order $orderId quantity mismatch")
              failed = true
            }
            if (detail.get("product_id").asInt() != productId) {
              log(s"  FAIL: product $productId: order $orderId product_id mismatch")
              failed = true
            }

            // Collect idempotency key
            if (detail.has("idempotency_key")) {
              collectedKeys = collectedKeys :+ detail.get("idempotency_key").asText()
            }
          } catch {
            case _: Exception =>
              log(s"  FAIL: product $productId: order $orderId JSON parse error")
              failed = true
          }

          session
            .set("validationFailed", failed)
            .set("valCollectedKeys", collectedKeys)
            .set("valOrderIndex", session("valOrderIndex").as[Int] + 1)
        }
      }
      // Check idempotency key uniqueness within this product
      .exec { session =>
        val productId = session("valProductId").as[Int]
        val keys = session("valCollectedKeys").as[Seq[String]]
        val uniqueKeys = keys.toSet
        var failed = session("validationFailed").as[Boolean]

        if (keys.size != uniqueKeys.size) {
          log(s"  FAIL: product $productId: duplicate idempotency_keys (${keys.size} keys, ${uniqueKeys.size} unique)")
          failed = true
        } else {
          log(s"  PASS: no duplicate idempotency_keys (${keys.size} keys)")
        }

        // Add to global collection
        val allIdempotencyKeys = session("allIdempotencyKeys").as[Seq[(String, Int)]] ++ keys.map(k => (k, productId))

        session
          .set("allIdempotencyKeys", allIdempotencyKeys)
          .set("validationFailed", failed)
      }
      // ---------------------------------------------------------------
      // Rule 5: Cancel safety — re-cancelling returns 409, stock unchanged
      // ---------------------------------------------------------------
      .exec { session =>
        val cancelledIds = session("valCancelledOrderIds").as[Seq[String]]
        val samplesToTest = cancelledIds.take(3)
        session
          .set("valCancelSamples", samplesToTest)
          .set("valCancelSampleIdx", 0)
      }
      .asLongAs(session => session("valCancelSampleIdx").as[Int] < session("valCancelSamples").as[Seq[String]].size) {
        // Get stock before re-cancel
        exec(
          http("validation_get_product_before_recancel")
            .get("/products/#{valProductId}")
            .check(status.is(200))
            .check(jsonPath("$.stock").saveAs("valStockBefore"))
        )
        .exec { session =>
          val idx = session("valCancelSampleIdx").as[Int]
          val samples = session("valCancelSamples").as[Seq[String]]
          session.set("valReCancelOrderId", samples(idx))
        }
        .exec(
          http("validation_recancel_order")
            .post("/orders/#{valReCancelOrderId}/cancel")
            .check(status.saveAs("valReCancelStatus"))
        )
        // Get stock after re-cancel
        .exec(
          http("validation_get_product_after_recancel")
            .get("/products/#{valProductId}")
            .check(status.is(200))
            .check(jsonPath("$.stock").saveAs("valStockAfter"))
        )
        .exec { session =>
          val productId = session("valProductId").as[Int]
          val orderId = session("valReCancelOrderId").as[String]
          val reCancelStatus = session("valReCancelStatus").as[String].toInt
          val stockBefore = session("valStockBefore").as[String].toInt
          val stockAfter = session("valStockAfter").as[String].toInt
          var failed = session("validationFailed").as[Boolean]

          if (reCancelStatus != 409) {
            log(s"  FAIL: product $productId: re-cancel order $orderId returned $reCancelStatus (expected 409)")
            failed = true
          }
          if (stockBefore != stockAfter) {
            log(s"  FAIL: product $productId: stock changed after re-cancel (before=$stockBefore, after=$stockAfter)")
            failed = true
          }

          session
            .set("validationFailed", failed)
            .set("valCancelSampleIdx", session("valCancelSampleIdx").as[Int] + 1)
        }
      }
      // Test 404 for non-existent order
      .exec(
        http("validation_get_nonexistent_order")
          .get("/orders/00000000-0000-4000-8000-000000000000")
          .check(status.is(404))
      )
      // Test 422 for invalid order_id format
      .exec(
        http("validation_get_invalid_order_id")
          .get("/orders/not-a-valid-uuid")
          .check(status.is(422))
      )
      .exec { session =>
        val productId = session("valProductId").as[Int]
        log(s"  Product $productId checks complete.")
        session
      }
    }
    // ---------------------------------------------------------------
    // Cross-product checks
    // ---------------------------------------------------------------
    .exec { session =>
      log("--- Cross-product duplicate check ---")

      val allOrderIds = session("allOrderIds").as[Seq[(String, Int)]]
      val allIdempotencyKeys = session("allIdempotencyKeys").as[Seq[(String, Int)]]
      var failed = session("validationFailed").as[Boolean]

      // Check for cross-product duplicate order IDs
      val seenIds = scala.collection.mutable.HashMap.empty[String, Int]
      var crossDuplicates = 0
      for ((orderId, productId) <- allOrderIds) {
        seenIds.get(orderId) match {
          case Some(prevProductId) =>
            log(s"  DUPLICATE: order $orderId in product $prevProductId and $productId")
            crossDuplicates += 1
          case None =>
            seenIds(orderId) = productId
        }
      }
      if (crossDuplicates > 0) {
        log(s"  FAIL: found $crossDuplicates cross-product duplicate order_ids")
        failed = true
      } else {
        log(s"  PASS: no cross-product duplicate order_ids (${allOrderIds.size} total)")
      }

      // Check for cross-product duplicate idempotency keys
      log("--- Cross-product idempotency_key duplicate check ---")
      val seenKeys = scala.collection.mutable.HashMap.empty[String, Int]
      var keyDuplicates = 0
      for ((key, productId) <- allIdempotencyKeys) {
        seenKeys.get(key) match {
          case Some(prevProductId) =>
            log(s"  DUPLICATE KEY: idempotency_key $key in product $prevProductId and $productId")
            keyDuplicates += 1
          case None =>
            seenKeys(key) = productId
        }
      }
      if (keyDuplicates > 0) {
        log(s"  FAIL: found $keyDuplicates cross-product duplicate idempotency_keys")
        failed = true
      } else {
        log(s"  PASS: no cross-product duplicate idempotency_keys (${allIdempotencyKeys.size} total)")
      }

      log(s"=== Validation complete ===")

      if (failed) {
        log("RESULT: FAIL — One or more validation rules failed")
        session.markAsFailed
      } else {
        log("RESULT: PASS — All validation rules passed")
        session
      }
    }
}
