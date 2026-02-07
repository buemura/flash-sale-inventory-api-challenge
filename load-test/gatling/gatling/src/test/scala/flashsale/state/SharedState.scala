package flashsale.state

import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicInteger

object SharedState {
  case class CreatedOrder(orderId: String, productId: Int, quantity: Int)

  val createdOrders = new ConcurrentLinkedQueue[CreatedOrder]()

  val ordersCreatedCount = new AtomicInteger(0)
  val stockExhaustedCount = new AtomicInteger(0)
  val ordersCancelledCount = new AtomicInteger(0)
  val cancelAlreadyCancelledCount = new AtomicInteger(0)
  val idempotentReplaysCorrectCount = new AtomicInteger(0)
  val getOrderSuccessCount = new AtomicInteger(0)

  def reset(): Unit = {
    createdOrders.clear()
    ordersCreatedCount.set(0)
    stockExhaustedCount.set(0)
    ordersCancelledCount.set(0)
    cancelAlreadyCancelledCount.set(0)
    idempotentReplaysCorrectCount.set(0)
    getOrderSuccessCount.set(0)
  }
}
