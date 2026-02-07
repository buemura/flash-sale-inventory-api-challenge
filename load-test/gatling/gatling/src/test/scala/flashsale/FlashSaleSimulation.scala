package flashsale

import io.gatling.core.Predef._
import io.gatling.http.Predef._
import scala.concurrent.duration._
import flashsale.config.TestConfig
import flashsale.scenarios._

class FlashSaleSimulation extends Simulation {

  // ---------------------------------------------------------------------------
  // Safety net: force JVM exit if the simulation hangs after completion.
  // Gatling's maxDuration sometimes fails to terminate mixed-model simulations.
  // ---------------------------------------------------------------------------
  before {
    val killThread = new Thread(() => {
      Thread.sleep(240000) // 4 minutes
      System.err.println("[TIMEOUT] Simulation did not exit within 4 minutes — forcing JVM shutdown")
      System.exit(0)
    })
    killThread.setDaemon(true)
    killThread.start()
  }

  after {
    println("[simulation] after() hook fired — simulation engine finished")
  }

  val httpProtocol = http
    .baseUrl(TestConfig.baseUrl)
    .acceptHeader("application/json")
    .contentTypeHeader("application/json")
    .shareConnections
    .maxConnectionsPerHost(64)

  // ---------------------------------------------------------------------------
  // Phase 1 — Warm-up: 1 VU, runs for 10s
  // ---------------------------------------------------------------------------
  val warmup = WarmupScenario.scn.inject(
    atOnceUsers(1)
  )

  // ---------------------------------------------------------------------------
  // Phase 2 — Flash Sale Burst: ramp 0→50 (5s), hold 50 (45s), ramp 50→0 (10s)
  //           Starts at 15s (use 0 concurrent users as delay for closed model)
  // ---------------------------------------------------------------------------
  val flashSale = FlashSaleScenario.scn.inject(
    constantConcurrentUsers(0).during(15.seconds),
    rampConcurrentUsers(0).to(50).during(5.seconds),
    constantConcurrentUsers(50).during(45.seconds),
    rampConcurrentUsers(50).to(0).during(10.seconds)
  )

  // ---------------------------------------------------------------------------
  // Phase 2b — Idempotency Retries: 10 VUs for 55s, starts at 15s
  // ---------------------------------------------------------------------------
  val idempotencyRetries = IdempotencyScenario.scn.inject(
    constantConcurrentUsers(0).during(15.seconds),
    constantConcurrentUsers(10).during(55.seconds),
    rampConcurrentUsers(10).to(0).during(1.seconds)
  )

  // ---------------------------------------------------------------------------
  // Phase 3 — Cancellation Wave: ramp 0→30 (5s), hold 30 (20s), ramp 30→0 (5s)
  //           Starts at 85s
  // ---------------------------------------------------------------------------
  val cancelWave = CancelWaveScenario.scn.inject(
    constantConcurrentUsers(0).during(85.seconds),
    rampConcurrentUsers(0).to(30).during(5.seconds),
    constantConcurrentUsers(30).during(20.seconds),
    rampConcurrentUsers(30).to(0).during(5.seconds)
  )

  // ---------------------------------------------------------------------------
  // Phase 3b — Post-Cancel Orders: 10 VUs for 25s, starts at 88s
  // ---------------------------------------------------------------------------
  val postCancelOrders = FlashSaleScenario.postCancelScn.inject(
    constantConcurrentUsers(0).during(88.seconds),
    constantConcurrentUsers(10).during(25.seconds),
    rampConcurrentUsers(10).to(0).during(1.seconds)
  )

  // ---------------------------------------------------------------------------
  // Phase 3c — Get Order by ID: 5 VUs for 25s, starts at 88s
  // ---------------------------------------------------------------------------
  val getOrder = GetOrderScenario.scn.inject(
    constantConcurrentUsers(0).during(88.seconds),
    constantConcurrentUsers(5).during(25.seconds),
    rampConcurrentUsers(5).to(0).during(1.seconds)
  )

  // ---------------------------------------------------------------------------
  // Phase 4 — Validation: 1 VU, single iteration, runs after all load phases
  //           Load phases end by ~115s, pause(125s) in scenario delays execution
  // ---------------------------------------------------------------------------
  val validation = ValidationScenario.scn.inject(
    atOnceUsers(1)
  )

  // ---------------------------------------------------------------------------
  // Wire it all together
  // ---------------------------------------------------------------------------
  setUp(
    warmup,
    flashSale,
    idempotencyRetries,
    cancelWave,
    postCancelOrders,
    getOrder,
    validation
  )
  .protocols(httpProtocol)
  .maxDuration(3.minutes)
  .assertions(
    global.responseTime.percentile(99).lt(500),
    global.failedRequests.percent.lt(1.0),
    global.successfulRequests.count.gt(0L)
  )
}
