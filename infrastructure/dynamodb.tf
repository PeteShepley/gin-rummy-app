# Single-table store for the WebSocket relay's rooms. Keyed (PK, SK):
#   ROOM#<code> / META        -> room metadata + the nextSeq counter
#   ROOM#<code> / SEQ#<n>      -> one stamped action (the ordered log)
#   CONN#<connectionId> / CONN -> reverse lookup for $disconnect
# See services/relay/src/store.ts. On-demand billing suits the bursty,
# two-players-at-a-time load; the `ttl` attribute garbage-collects orphaned or
# never-joined rooms (live rooms are deleted eagerly on abandonment).
resource "aws_dynamodb_table" "rooms" {
  name         = "gin-rummy-rooms"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}
