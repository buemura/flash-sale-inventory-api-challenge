package flashsale.helpers

import flashsale.config.TestConfig
import scala.util.Random

object WeightedProductPicker {
  private val random = new Random()

  def pick(): Int = {
    var r = random.nextDouble() * TestConfig.totalWeight
    for (pw <- TestConfig.productWeights) {
      r -= pw.weight
      if (r <= 0) return pw.id
    }
    5
  }
}
