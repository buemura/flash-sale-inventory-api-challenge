package flashsale.config

object TestConfig {
  val baseUrl: String = sys.env.getOrElse("BASE_URL", "http://host.docker.internal:9999")

  case class Product(id: Int, name: String, initialStock: Int)

  case class ProductWeight(id: Int, weight: Int)

  val products: Seq[Product] = Seq(
    Product(1, "Mechanical Keyboard Ultra", 100),
    Product(2, "Wireless Mouse Pro", 50),
    Product(3, "USB-C Hub 7-in-1", 200),
    Product(4, "4K Webcam Stream", 10),
    Product(5, "Noise-Cancel Headphones", 30)
  )

  val productWeights: Seq[ProductWeight] = Seq(
    ProductWeight(1, 10),
    ProductWeight(2, 10),
    ProductWeight(3, 10),
    ProductWeight(4, 35),
    ProductWeight(5, 35)
  )

  val totalWeight: Int = productWeights.map(_.weight).sum
}
