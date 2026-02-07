package flashsale.helpers

import com.fasterxml.jackson.databind.{JsonNode, ObjectMapper}

object JsonHelper {
  private val mapper = new ObjectMapper()

  def parse(json: String): JsonNode = mapper.readTree(json)
}
