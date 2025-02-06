```mermaid
sequenceDiagram
    participant Client
    participant ConnectServer
    participant anydb
    participant Redis
    participant Kafka
    participant Worker

    Client->>ConnectServer: publish (UpsertRequest)
    ConnectServer->>anydb: upsert
    anydb->>Redis: upsert
    ConnectServer->>Kafka: send (worker)
    Kafka->>Worker: consume (worker)
    Worker->>anydb: fetch_snapshot
    anydb->>Redis: fetch_snapshot
    Worker->>Kafka: send (reply_to)
    Kafka->>ConnectServer: consume (reply_to)
    ConnectServer->>Client: getSnapshot (GetSnapshotResponse)

    Client->>ConnectServer: getDeltas (GetDeltasRequest)
    ConnectServer->>anydb: fetch_deltas
    anydb->>Redis: fetch_deltas
    ConnectServer->>Client: getDeltas (GetDeltasResponse)

    Client->>ConnectServer: publishWithTimeout (DelayedUpsertRequest)
    ConnectServer->>Kafka: send (worker)
    Kafka->>Worker: consume (worker)
    Worker->>Kafka: send (reply_to)
    Kafka->>ConnectServer: consume (reply_to)
    ConnectServer->>Client: publishWithTimeout (DelayedUpsertResponse)

    Client->>ConnectServer: publishWithTimeoutHeartbeats (KeepAlives)
    ConnectServer->>Kafka: send (worker)
    Kafka->>Worker: consume (worker)
    Worker->>Kafka: send (reply_to)
    Kafka->>ConnectServer: consume (reply_to)
    ConnectServer->>Client: publishWithTimeoutHeartbeats (Empty)
